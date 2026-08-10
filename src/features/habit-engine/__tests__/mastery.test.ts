import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import type { TaskBankEntry } from '../../../core/domain/task-bank';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { LEVELS } from '../../../data/curriculum';
import { HabitProgressionService } from '../planner';
import {
  MASTERY_THRESHOLD,
  masteryEligibility,
  computeTaskMastery,
  effectiveBucket,
  computeMasterySummary,
  computeLevelsClearedByMastery,
} from '../mastery';
import { dateForContentDay } from '../dates';

const START = '2026-01-01';

function dailyEntry(id: string, fromDay = 1): TaskBankEntry {
  return {
    id,
    habitId: 'h1',
    title: id,
    description: '',
    phase: 'jee-core',
    difficulty: 2,
    estimatedDurationMin: 20,
    energyLevel: 'medium',
    tags: [],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.2,
    backlogSuitability: 0.2,
    thinkingSkills: ['focus'],
    jeeRelevance: { score: 0.5 },
    unlockConditions: [{ type: 'day', fromDay }],
    active: true,
  };
}

/** State where `doneDays` (content days) have the task marked done. */
function stateWithLogs(doneDays: number[], restDays: number[] = []): AppState {
  const s = { ...emptyAppState(), startDateISO: START, restDays };
  for (const d of doneDays) {
    const date = dateForContentDay(d, START, restDays);
    s.taskLogs[date] = { ...(s.taskLogs[date] ?? {}), t1: true };
  }
  return s;
}

describe('masteryEligibility', () => {
  it('daily (day) tasks are eligible', () => {
    expect(masteryEligibility(dailyEntry('t1'))).toBe('daily');
  });

  it('one-off tasks are never mastery-eligible', () => {
    const cases: TaskBankEntry['unlockConditions'][] = [
      [{ type: 'day-exact', day: 5 }],
      [{ type: 'day-in', days: [5, 12] }],
      [{ type: 'weekday', days: [0] }],
      [{ type: 'mock-sunday' }],
      [{ type: 'exam-window', daysBeforeExam: 30 }],
    ];
    for (const conditions of cases) {
      expect(masteryEligibility({ ...dailyEntry('t1'), unlockConditions: conditions })).toBe('one-off');
    }
  });
});

describe('computeTaskMastery — the 5-day rule', () => {
  const entry = dailyEntry('t1');

  it('reaches mastery after 5 done days; 6th+ day stays mastered', () => {
    const m = computeTaskMastery(stateWithLogs([1, 2, 3, 4, 5]), entry, 7);
    expect(m.masteredAtDay).toBe(5);
    expect(m.count).toBe(MASTERY_THRESHOLD);
  });

  it('today never counts: 4 done + today done = not yet mastered', () => {
    // Logs on days 1-4, today is day 5 (still in progress, log not present).
    const m = computeTaskMastery(stateWithLogs([1, 2, 3, 4]), entry, 5);
    expect(m.masteredAtDay).toBeNull();
    expect(m.count).toBe(4);
  });

  it('one missed day is tolerated (count is kept)', () => {
    // Days 1-4 done, day 5 missed (grace), day 6 done → mastered on day 6.
    const m = computeTaskMastery(stateWithLogs([1, 2, 3, 4, 6]), entry, 7);
    expect(m.masteredAtDay).toBe(6);
    expect(m.count).toBe(5);
  });

  it('a second consecutive miss resets the count to 0', () => {
    // Days 1-3 done, days 4-5 missed (2 consecutive), day 6 done → count 1.
    const m = computeTaskMastery(stateWithLogs([1, 2, 3, 6]), entry, 7);
    expect(m.masteredAtDay).toBeNull();
    expect(m.count).toBe(1);
    expect(m.consecutiveMisses).toBe(0); // day 6 done cleared the miss streak
  });

  it('a partial day (some done) keeps a 1-miss grace from resetting', () => {
    // Days 1-2 done, day 3 missed, day 4 done → count 3 (grace kept count).
    const s = stateWithLogs([1, 2, 4]);
    s.taskLogs[dateForContentDay(3, START, [])] = {}; // day 3 present but empty = missed
    const m = computeTaskMastery(s, entry, 5);
    expect(m.count).toBe(3);
    expect(m.masteredAtDay).toBeNull();
  });

  it('rest days are skipped entirely — neither done nor missed', () => {
    // Rest day 3: content 3 is a holiday. Done on 1,2,4,5,6 → mastered day 6.
    const s = stateWithLogs([1, 2, 4, 5, 6], [3]);
    const m = computeTaskMastery(s, entry, 7);
    expect(m.masteredAtDay).toBe(6);
  });

  it('rest days are skipped in miss counting — the break does not reset the streak', () => {
    // done day 1, miss day 2, REST day 3, done day 4 → grace preserved:
    // without the rest-skip the day-3 miss would make 2 consecutive misses and reset.
    const s = stateWithLogs([1, 4], [3]);
    const m = computeTaskMastery(s, entry, 5);
    expect(m.count).toBe(2);
    expect(m.masteredAtDay).toBeNull();
    expect(m.consecutiveMisses).toBe(0);
  });

  it('one-off tasks never master even with 5+ done days', () => {
    const oneOff: TaskBankEntry['unlockConditions'] = [{ type: 'day-exact', day: 5 }];
    const pinned = { ...dailyEntry('t1'), unlockConditions: oneOff };
    const m = computeTaskMastery(stateWithLogs([5]), pinned, 6);
    expect(m.masteredAtDay).toBeNull();
    expect(m.count).toBe(0);
  });

  it('respects the unlock day: earlier days are not scanned', () => {
    const late = dailyEntry('t1', 10);
    const m = computeTaskMastery(stateWithLogs([1, 2, 3, 4, 5]), late, 12);
    expect(m.count).toBe(0);
  });
});

describe('effectiveBucket', () => {
  it('computed-mastered tasks sit in the completed bucket', () => {
    expect(effectiveBucket(undefined, true, 10)).toBe('completed');
  });

  it('non-mastered tasks without placement stay in normal rotation', () => {
    expect(effectiveBucket(undefined, false, 10)).toBe('normal');
  });

  it('scheduled for today → scheduled-today (re-enters the plan)', () => {
    expect(effectiveBucket({ bucket: 'scheduled', day: 10 }, true, 10)).toBe('scheduled-today');
    expect(effectiveBucket({ bucket: 'scheduled', day: 10 }, false, 10)).toBe('scheduled-today');
  });

  it('scheduled for another day → completed until that day arrives', () => {
    expect(effectiveBucket({ bucket: 'scheduled', day: 15 }, true, 10)).toBe('completed');
  });

  it('manual completed placement pins the task even before 5 days', () => {
    expect(effectiveBucket({ bucket: 'completed' }, false, 10)).toBe('completed');
  });
});

describe('computeMasterySummary', () => {
  function makePlanner() {
    const repo = new TaskBankRepositoryImpl(
      { load: () => ({ dynamicTaskBank: [] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
      buildSeed(),
    );
    const bank = new TaskBankServiceImpl(repo);
    const planner = new HabitProgressionService({ taskBank: bank, habits: repo, levels: LEVELS, totalDays: 90 });
    return { planner, bank };
  }

  it('collects daily seed + dynamic tasks and reports mastered ids', () => {
    const { planner } = makePlanner();
    // First 5 days fully done → every unlocked daily task is mastered.
    const s = { ...emptyAppState(), startDateISO: START };
    for (let d = 1; d <= 5; d++) {
      const date = dateForContentDay(d, START, []);
      const log: Record<string, boolean> = {};
      for (const t of planner.stats.baseTasksForDay(d)) log[t.id] = true;
      s.taskLogs[date] = log;
    }
    const summary = computeMasterySummary(s, 6, (d) => planner.stats.baseTasksForDay(d));
    expect(summary.dayNumber).toBe(6);
    expect(summary.masteredIds.length).toBeGreaterThan(0);
    // Every mastered id is a real entry.
    for (const id of summary.masteredIds) expect(summary.entriesById.has(id)).toBe(true);
  });

  it('includes dynamic daily tasks in the mastery pool', () => {
    const { planner } = makePlanner();
    const dynamic = dailyEntry('dyn-daily');
    const s = { ...emptyAppState(), startDateISO: START, dynamicTaskBank: [dynamic] };
    for (let d = 1; d <= 5; d++) {
      const date = dateForContentDay(d, START, []);
      s.taskLogs[date] = { ...(s.taskLogs[date] ?? {}), 'dyn-daily': true };
    }
    const summary = computeMasterySummary(s, 6, (d) => planner.stats.baseTasksForDay(d));
    expect(summary.masteredIds).toContain('dyn-daily');
  });
});

describe('computeLevelsClearedByMastery', () => {
  it('a level is cleared when every one of its tasks is mastered', () => {
    const repo = new TaskBankRepositoryImpl(
      { load: () => ({ dynamicTaskBank: [] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
      buildSeed(),
    );
    const bank = new TaskBankServiceImpl(repo);
    const s = { ...emptyAppState(), startDateISO: START };
    // Mark level-1 tasks done for 5 straight days.
    const level1Tasks = bank.findByLevel(1);
    expect(level1Tasks.length).toBeGreaterThan(0);
    for (let d = 1; d <= 5; d++) {
      const date = dateForContentDay(d, START, []);
      const log: Record<string, boolean> = {};
      for (const t of level1Tasks) log[t.id] = true;
      s.taskLogs[date] = log;
    }
    const result = computeLevelsClearedByMastery(s, 6, bank, LEVELS);
    expect(result.clearedByMastery).toContain(1);
  });
});
