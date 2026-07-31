import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { DEFAULT_PROGRESSION_CONFIG } from '../../../core/domain/progress';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { HabitProgressionService } from '../planner';
import { LEVELS, TOTAL_DAYS } from '../../../data/curriculum';
import type { TaskBankEntry } from '../../../core/domain/task-bank';

function makePlanner() {
  const repo = new TaskBankRepositoryImpl(
    { load: () => ({ dynamicTaskBank: [] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
    buildSeed(),
  );
  const bank = new TaskBankServiceImpl(repo);
  const planner = new HabitProgressionService({ taskBank: bank, habits: repo, levels: LEVELS, totalDays: TOTAL_DAYS });
  return { planner, bank };
}

/** Reference cumulative legacy list: day-unlocked curriculum tasks in level/order. */
function referenceCumulative(entries: TaskBankEntry[], dayNumber: number): string[] {
  return entries
    .filter((t) => t.legacy && t.unlockConditions.some((c) => c.type === 'day' && c.fromDay <= dayNumber))
    .sort((a, b) => (a.legacy!.levelId - b.legacy!.levelId) || (a.legacy!.order - b.legacy!.order))
    .map((t) => t.id);
}

function healthyState(): AppState {
  return { ...emptyAppState(), startDateISO: '2026-01-01' };
}

/** A state where the previous few days were completed 100% → truly healthy. */
function healthyStateWithRecentCompletion(planner: HabitProgressionService, todayDay: number): AppState {
  const state = healthyState();
  for (let d = Math.max(1, todayDay - 4); d < todayDay; d++) {
    const iso = isoFromDay(d);
    const log: Record<string, boolean> = {};
    for (const t of planner.stats.baseTasksForDay(d)) log[t.id] = true;
    state.taskLogs[iso] = log;
  }
  return state;
}

function isoFromDay(day: number): string {
  const start = new Date('2026-01-01T00:00:00');
  start.setDate(start.getDate() + (day - 1));
  return start.toISOString().slice(0, 10);
}

describe('HabitProgressionService backward compatibility', () => {
  // Pure legacy mode: AI layer off. The plan must be byte-for-byte the old
  // cumulative curriculum list.
  const legacyConfig = { ...DEFAULT_PROGRESSION_CONFIG, aiEnabled: false };

  it('base plan on a healthy day matches the legacy cumulative task list', () => {
    const { planner, bank } = makePlanner();
    // Non-Sunday days (mock tasks only join the plan on mock Sundays).
    for (const day of [1, 5, 8, 30, 45, 90]) {
      const dateISO = isoFromDay(day);
      const state = healthyStateWithRecentCompletion(planner, day);
      const plan = planner.buildPlan(state, dateISO, legacyConfig);
      const expected = referenceCumulative(bank.getAll(), day);
      expect(plan.tasks.map((t) => t.entry.id)).toEqual(expected);
      expect(plan.tasks.every((t) => t.required)).toBe(true);
    }
  });

  it('healthy plan requires all tasks and injects nothing', () => {
    const { planner, bank } = makePlanner();
    const state = healthyStateWithRecentCompletion(planner, 8);
    const plan = planner.buildPlan(state, isoFromDay(8), legacyConfig);
    const expected = referenceCumulative(bank.getAll(), 8);
    expect(plan.tasks.map((t) => t.entry.id)).toEqual(expected);
    expect(plan.tasks.every((t) => t.required)).toBe(true);
    expect(plan.generationStrategy).toBe('bank');
  });

  it('applies recovery mode when yesterday completed poorly', () => {
    const { planner } = makePlanner();
    const state = healthyState();
    // Yesterday (2026-01-07) all base tasks were missed → recovery.
    state.taskLogs['2026-01-07'] = {};
    const plan = planner.buildPlan(state, '2026-01-08', DEFAULT_PROGRESSION_CONFIG);
    expect(plan.contextSummary).toContain('recovery');
    const currentLevel = LEVELS.find((l) => 8 >= l.dayStart && 8 <= l.dayEnd)!;
    const coreIds = new Set(
      plan.tasks.filter((t) => t.required).map((t) => t.entry.id),
    );
    // Only the current level's tasks may be required.
    for (const t of plan.tasks) {
      if (t.required) expect(t.entry.legacy?.levelId).toBe(currentLevel.id);
      void coreIds;
    }
  });

  it('injects recommended tasks for weak habits without touching required set', () => {
    const { planner, bank } = makePlanner();
    const state = healthyState();
    // Low-but-not-crashing completion yesterday (60%) → no recovery mode,
    // but backlog signals may still inject gentle recommendations.
    const yesterday = '2026-01-07';
    const base = planner.stats.baseTasksForDay(7);
    const log: Record<string, boolean> = {};
    base.forEach((t, i) => {
      if (i % 2 === 0) log[t.id] = true;
    });
    state.taskLogs[yesterday] = log;
    const plan = planner.buildPlan(state, '2026-01-08', DEFAULT_PROGRESSION_CONFIG);

    const requiredIds = plan.tasks.filter((t) => t.required).map((t) => t.entry.id);
    const expectedIds = referenceCumulative(bank.getAll(), 8);
    expect(requiredIds).toEqual(expectedIds);

    // Any non-required additions must be legit bank entries, never duplicates.
    const seen = new Set(requiredIds);
    for (const t of plan.tasks.filter((p) => !p.required)) {
      expect(seen.has(t.entry.id)).toBe(false);
      expect(t.reason.startsWith('recommended')).toBe(true);
      seen.add(t.entry.id);
    }
  });
});

describe('HabitProgressionService dynamic (custom/AI) tasks', () => {
  it('includes unlocked dynamic entries in their natural slot, once per plan', () => {
    const dynamic: TaskBankEntry = {
      id: 'ai-test-1',
      habitId: 'h1',
      title: 'Thermodynamics ke 3 revision problems',
      description: 'custom task',
      phase: 'jee-core',
      difficulty: 3,
      estimatedDurationMin: 30,
      energyLevel: 'medium',
      tags: [],
      prerequisites: [],
      taskType: 'Review',
      revisionSuitability: 0.5,
      backlogSuitability: 0.2,
      thinkingSkills: ['recall'],
      jeeRelevance: { subject: 'physics', score: 0.5 },
      unlockConditions: [{ type: 'day', fromDay: 3 }],
      active: true,
    };
    const repo = new TaskBankRepositoryImpl(
      {
        load: () => ({ dynamicTaskBank: [dynamic] }) as unknown as AppState,
        save: () => undefined,
        clear: () => undefined,
      },
      buildSeed(),
    );
    const bank = new TaskBankServiceImpl(repo);
    const planner = new HabitProgressionService({ taskBank: bank, habits: repo, levels: LEVELS, totalDays: TOTAL_DAYS });

    // Day 8: unlocked (fromDay 3) and recent days completed → no recovery mode.
    const state = { ...healthyStateWithRecentCompletion(planner, 8), dynamicTaskBank: [dynamic] };
    const plan = planner.buildPlan(state, isoFromDay(8), DEFAULT_PROGRESSION_CONFIG);
    const custom = plan.tasks.find((t) => t.entry.id === 'ai-test-1');
    expect(custom).toBeDefined();
    expect(custom?.source).toBe('ai');
    expect(custom?.reason).toBe('custom');
    expect(custom?.group).toBe('night');
    expect(plan.tasks.filter((t) => t.entry.id === 'ai-test-1').length).toBe(1);
  });

  it('does not include dynamic entries whose day has not unlocked yet', () => {
    const dynamic: TaskBankEntry = {
      id: 'ai-test-locked',
      habitId: 'h1',
      title: 'Future task',
      description: 'custom',
      phase: 'jee-core',
      difficulty: 2,
      estimatedDurationMin: 15,
      energyLevel: 'low',
      tags: [],
      prerequisites: [],
      taskType: 'Beginner',
      revisionSuitability: 0.2,
      backlogSuitability: 0.2,
      thinkingSkills: ['planning'],
      jeeRelevance: { subject: 'physics', score: 0.3 },
      unlockConditions: [{ type: 'day', fromDay: 20 }],
      active: true,
    };
    const repo = new TaskBankRepositoryImpl(
      {
        load: () => ({ dynamicTaskBank: [dynamic] }) as unknown as AppState,
        save: () => undefined,
        clear: () => undefined,
      },
      buildSeed(),
    );
    const bank = new TaskBankServiceImpl(repo);
    const planner = new HabitProgressionService({ taskBank: bank, habits: repo, levels: LEVELS, totalDays: TOTAL_DAYS });

    const plan = planner.buildPlan(healthyState(), isoFromDay(8), DEFAULT_PROGRESSION_CONFIG);
    expect(plan.tasks.some((t) => t.entry.id === 'ai-test-locked')).toBe(false);
  });
});
