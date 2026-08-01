import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { DEFAULT_PROGRESSION_CONFIG } from '../../../core/domain/progress';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { isUnlockMet, TaskBankServiceImpl, type UnlockSnapshot } from '../../task-bank/task-bank.service';
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

/** Pure legacy mode: AI layer off. The plan must be byte-for-byte the old cumulative list. */
const legacyConfig = { ...DEFAULT_PROGRESSION_CONFIG, aiEnabled: false };

/** Reference curriculum list: legacy tasks whose cadence passes on that date. */
function referenceCumulative(entries: TaskBankEntry[], dayNumber: number, dateISO: string): string[] {
  const weekday = new Date(dateISO + 'T00:00:00').getDay();
  const snapshot: UnlockSnapshot = {
    dayNumber,
    phase: 'jee-core',
    unlockedHabitIds: [],
    examWindowActive: false,
    mockSunday: weekday === 0,
    weekday,
    recoveryMode: false,
    backlogDays: 0,
    revisionDueHabitIds: [],
  };
  return entries
    .filter((t) => t.legacy && isUnlockMet(t, snapshot))
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
  it('base plan on a healthy day matches the legacy cumulative task list', () => {
    const { planner, bank } = makePlanner();
    // Non-Sunday days (mock tasks only join the plan on mock Sundays).
    for (const day of [1, 5, 8, 30, 45, 90]) {
      const dateISO = isoFromDay(day);
      const state = healthyStateWithRecentCompletion(planner, day);
      const plan = planner.buildPlan(state, dateISO, legacyConfig);
      const expected = referenceCumulative(bank.getAll(), day, dateISO);
      expect(plan.tasks.map((t) => t.entry.id)).toEqual(expected);
      expect(plan.tasks.every((t) => t.required)).toBe(true);
    }
  });

  it('has planned tasks for every journey day across all phases', () => {
    const { planner } = makePlanner();
    const state = healthyState();

    for (let day = 1; day <= TOTAL_DAYS; day++) {
      const plan = planner.buildPlan(state, isoFromDay(day), legacyConfig);
      expect(plan.tasks.length, `Day ${day} should have at least one task`).toBeGreaterThan(0);
    }
  });

  it('has seed task coverage for every level across all phases', () => {
    const { bank } = makePlanner();
    const entries = bank.getAll();

    for (const level of LEVELS) {
      const levelTasks = entries.filter((task) => task.legacy?.levelId === level.id && task.active);
      expect(levelTasks.length, `Level ${level.id} should have seed tasks`).toBeGreaterThan(0);
    }
  });

  it('healthy plan requires all tasks and injects nothing', () => {
    const { planner, bank } = makePlanner();
    const state = healthyStateWithRecentCompletion(planner, 8);
    const plan = planner.buildPlan(state, isoFromDay(8), legacyConfig);
    const expected = referenceCumulative(bank.getAll(), 8, isoFromDay(8));
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
    const expectedIds = referenceCumulative(bank.getAll(), 8, '2026-01-08');
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

  it('adapts the daily plan to recent progress (weak habits, gaps, backlog)', () => {
    const { planner, bank } = makePlanner();
    const day = 30;
    const dateISO = isoFromDay(day);

    // Fully consistent user: the last week was 100% completed.
    const onTrack = healthyStateWithRecentCompletion(planner, day);
    // Falling behind: previous days were all missed → gaps, backlog, weak habits.
    const fallingBehind = healthyState();

    const onTrackPlan = planner.buildPlan(onTrack, dateISO, DEFAULT_PROGRESSION_CONFIG);
    const behindPlan = planner.buildPlan(fallingBehind, dateISO, DEFAULT_PROGRESSION_CONFIG);

    // Day 30 is past the first few days, so weak/revision signals exist.
    expect(behindPlan.tasks.length).toBeGreaterThan(onTrackPlan.tasks.length);

    const extra = behindPlan.tasks.filter((t) => !onTrackPlan.tasks.some((o) => o.entry.id === t.entry.id));
    expect(extra.length).toBeGreaterThan(0);
    // Every added task is a real bank task (review/recovery), not a phantom.
    for (const t of extra) {
      expect(bank.getById(t.entry.id)).toBeTruthy();
    }
  });
});

describe('HabitProgressionService day-scoped scheduling', () => {
  it('a rest day drops all curriculum and AI tasks, keeping only explicit ones', () => {
    const { planner } = makePlanner();
    const explicit: TaskBankEntry = {
      id: 'ai-explicit',
      habitId: 'h1',
      title: 'Holiday pe planned study',
      description: '',
      phase: 'jee-core',
      difficulty: 1,
      estimatedDurationMin: 20,
      energyLevel: 'low',
      tags: [],
      prerequisites: [],
      taskType: 'Beginner',
      revisionSuitability: 0.2,
      backlogSuitability: 0.2,
      thinkingSkills: ['focus'],
      jeeRelevance: { score: 0.4 },
      unlockConditions: [{ type: 'day-exact', day: 5 }],
      active: true,
    };
    const state = { ...healthyState(), restDays: [5], dynamicTaskBank: [explicit] };
    const plan = planner.buildPlan(state, isoFromDay(5), DEFAULT_PROGRESSION_CONFIG);
    expect(plan.contextSummary).toContain('rest-day');
    expect(plan.tasks.map((t) => t.entry.id)).toEqual(['ai-explicit']);
    expect(plan.tasks[0].source).toBe('ai');
  });

  it('a rest day has an empty plan when nothing was explicitly scheduled', () => {
    const { planner } = makePlanner();
    const state = { ...healthyState(), restDays: [3] };
    const plan = planner.buildPlan(state, isoFromDay(3), DEFAULT_PROGRESSION_CONFIG);
    expect(plan.tasks).toEqual([]);
  });

  it('rest day suppresses the mock Sunday protocol too', () => {
    const { planner } = makePlanner();
    // 2026-01-04 is an actual Sunday (day 4); a rest day there must yield no tasks.
    const state = { ...healthyState(), restDays: [4] };
    const plan = planner.buildPlan(state, isoFromDay(4), DEFAULT_PROGRESSION_CONFIG);
    expect(plan.tasks).toEqual([]);
  });

  it('mock tasks only appear on actual calendar Sundays, not every 7th journey day', () => {
    const { planner, bank } = makePlanner();
    // 2026-01-04 is Sunday (day 4), 2026-01-11 is Sunday (day 11).
    for (const sundayDay of [4, 11]) {
      const plan = planner.buildPlan(healthyState(), isoFromDay(sundayDay), legacyConfig);
      const mocks = plan.tasks.filter((t) => t.entry.id.startsWith('mock_'));
      expect(mocks.length, `Day ${sundayDay} (Sunday) should have mock tasks`).toBeGreaterThan(0);
    }
    // 2026-01-07 is Wednesday (day 7, old "every 7th day" logic) — no mocks now.
    const wednesday = planner.buildPlan(healthyState(), isoFromDay(7), legacyConfig);
    expect(wednesday.tasks.some((t) => t.entry.id.startsWith('mock_'))).toBe(false);
    // 2026-01-14 is Wednesday again (day 14) — still no mocks.
    const day14 = planner.buildPlan(healthyState(), isoFromDay(14), legacyConfig);
    expect(day14.tasks.some((t) => t.entry.id.startsWith('mock_'))).toBe(false);
    void bank;
  });

  it('weekly review task only appears on Sundays once unlocked', () => {
    const { planner } = makePlanner();
    const hasWeekly = (day: number) =>
      planner.buildPlan(healthyState(), isoFromDay(day), legacyConfig).tasks.some((t) => t.entry.id === 'd12_t2');
    // 2026-01-04 = Sunday day 4 (before fromDay 34 → locked), 2026-02-01 = Sunday day 32 (locked),
    // 2026-02-08 = Sunday day 39 (unlocked → appears).
    expect(hasWeekly(4)).toBe(false);
    expect(hasWeekly(32)).toBe(false);
    expect(hasWeekly(39)).toBe(true);
    // 2026-02-09 = Monday day 40 (unlocked but not Sunday → hidden).
    expect(hasWeekly(40)).toBe(false);
  });

  it('month assessment appears only on journey days 30, 60 and 90', () => {
    const { planner } = makePlanner();
    const hasAssessment = (day: number) =>
      planner.buildPlan(healthyState(), isoFromDay(day), legacyConfig).tasks.some((t) => t.entry.id === 'd13_t3');
    expect(hasAssessment(30)).toBe(true);
    expect(hasAssessment(60)).toBe(true);
    expect(hasAssessment(90)).toBe(true);
    expect(hasAssessment(29)).toBe(false);
    expect(hasAssessment(37)).toBe(false);
    expect(hasAssessment(45)).toBe(false);
  });

  it('day-exact entries only appear on their scheduled day', () => {
    const { planner } = makePlanner();
    const pinned: TaskBankEntry = {
      id: 'ai-pinned',
      habitId: 'h1',
      title: 'Pinned task',
      description: '',
      phase: 'jee-core',
      difficulty: 1,
      estimatedDurationMin: 15,
      energyLevel: 'low',
      tags: [],
      prerequisites: [],
      taskType: 'Beginner',
      revisionSuitability: 0.2,
      backlogSuitability: 0.2,
      thinkingSkills: ['focus'],
      jeeRelevance: { score: 0.4 },
      unlockConditions: [{ type: 'day-exact', day: 10 }],
      active: true,
    };
    const state = { ...healthyState(), dynamicTaskBank: [pinned] };

    expect(planner.buildPlan(state, isoFromDay(10), DEFAULT_PROGRESSION_CONFIG).tasks.some((t) => t.entry.id === 'ai-pinned')).toBe(true);
    expect(planner.buildPlan(state, isoFromDay(9), DEFAULT_PROGRESSION_CONFIG).tasks.some((t) => t.entry.id === 'ai-pinned')).toBe(false);
    expect(planner.buildPlan(state, isoFromDay(11), DEFAULT_PROGRESSION_CONFIG).tasks.some((t) => t.entry.id === 'ai-pinned')).toBe(false);
  });

  it('a not-day override hides a built-in task on one day but keeps it on others', () => {
    const hiddenDay = 4;
    const seed = buildSeed().tasks.find((t) => t.id === 'd1_t1')!;
    const override: TaskBankEntry = {
      ...seed,
      active: true,
      unlockConditions: [...seed.unlockConditions, { type: 'not-day', day: hiddenDay }],
    };
    const repo = new TaskBankRepositoryImpl(
      { load: () => ({ dynamicTaskBank: [override] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
      buildSeed(),
    );
    const bank = new TaskBankServiceImpl(repo);
    const plannerHidden = new HabitProgressionService({ taskBank: bank, habits: repo, levels: LEVELS, totalDays: TOTAL_DAYS });

    expect(plannerHidden.buildPlan(healthyState(), isoFromDay(hiddenDay), DEFAULT_PROGRESSION_CONFIG).tasks.some((t) => t.entry.id === 'd1_t1')).toBe(false);
    expect(plannerHidden.buildPlan(healthyState(), isoFromDay(hiddenDay + 1), DEFAULT_PROGRESSION_CONFIG).tasks.some((t) => t.entry.id === 'd1_t1')).toBe(true);
    // The bank entry itself is never deleted.
    expect(bank.getById('d1_t1')).toBeTruthy();
  });
});
