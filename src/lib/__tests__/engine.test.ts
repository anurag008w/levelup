import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../core/domain/state';
import type { AppState } from '../../core/domain/state';
import type { Level } from '../../core/domain/habit';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import { LEVELS, PHASES } from '../../data/curriculum';
import {
  getCurrentDayNumber,
  getJourneyDayLimit,
  getLevelForDay,
  getLevelById,
  getCumulativeTasks,
  getCumulativeHabits,
  getHabitsByLevel,
  getTasksByLevel,
  tasksBySlot,
  getDayLog,
  toggleTask,
  completionPct,
  isRecoveryModeActive,
  splitRecoveryTasks,
  habitTasksOnDay,
  habitFirstActiveDay,
  computeHabitStreak,
  computeHabitScore,
  computeOverallStreak,
  getLevelStatus,
  currentWeekNumber,
  currentMonthNumber,
  isWeeklyReviewDue,
  isMonthlyAssessmentDue,
  pendingWeeklyWeek,
  pendingMonthlyMonth,
  isExamMonthActive,
  daysUntilExam,
} from '../../lib/engine';
import { TOTAL_DAYS } from '../../data/curriculum';

const START = '2026-01-01';

function stateAt(_today: string): AppState {
  return { ...emptyAppState(), startDateISO: START };
}

function makeEntry(id: string, unlock: TaskBankEntry['unlockConditions'], extra?: Partial<TaskBankEntry>): TaskBankEntry {
  return {
    id,
    habitId: 'daily_planning',
    title: id,
    description: '',
    phase: 'jee-core',
    difficulty: 1,
    estimatedDurationMin: 5,
    energyLevel: 'low',
    tags: [],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.2,
    backlogSuitability: 0.5,
    thinkingSkills: ['planning'],
    jeeRelevance: { score: 0.4 },
    unlockConditions: unlock,
    active: true,
    legacy: { levelId: 1, slot: 'morning', order: 1 },
    ...extra,
  };
}

describe('engine day numbers & journey limit', () => {
  it('returns 0 when the journey has not started', () => {
    expect(getCurrentDayNumber(emptyAppState(), '2026-01-01')).toBe(0);
  });

  it('clamps pre-start dates to day 1', () => {
    expect(getCurrentDayNumber(stateAt('2026-01-01'), '2025-12-31')).toBe(1);
  });

  it('clamps to the journey limit when running past 90 days', () => {
    expect(getCurrentDayNumber(stateAt('2026-01-01'), '2026-06-01')).toBe(TOTAL_DAYS);
  });

  it('journey limit defaults to 90', () => {
    expect(getJourneyDayLimit(stateAt('2026-01-01'))).toBe(TOTAL_DAYS);
  });

  it('journey limit extends past 90 when a dynamic task unlocks later', () => {
    const state = {
      ...stateAt('2026-01-01'),
      dynamicTaskBank: [makeEntry('ext', [{ type: 'day', fromDay: 120 }])],
    };
    expect(getJourneyDayLimit(state)).toBe(120);
  });

  it('journey limit extends for day-exact, not-day and day-in conditions', () => {
    const state = {
      ...stateAt('2026-01-01'),
      dynamicTaskBank: [
        makeEntry('a', [{ type: 'day-exact', day: 45 }]),
        makeEntry('b', [{ type: 'not-day', day: 200 }]),
        makeEntry('c', [{ type: 'day-in', days: [30, 75] }]),
      ],
    };
    expect(getJourneyDayLimit(state)).toBe(200);
  });

  it('journey limit extends past 90 after the journey completes', () => {
    const state = {
      ...stateAt('2026-01-01'),
      postJourney: { ...emptyAppState().postJourney, journeyComplete: true, extensionDays: 15 },
    };
    expect(getJourneyDayLimit(state)).toBe(TOTAL_DAYS + 15);
  });

  it('getCurrentDayNumber honours the post-journey limit', () => {
    const state = {
      ...stateAt('2026-01-01'),
      postJourney: { ...emptyAppState().postJourney, journeyComplete: true, extensionDays: 15 },
    };
    expect(getCurrentDayNumber(state, '2026-04-15')).toBe(105);
  });

  it('getCurrentDayNumber is rest-aware: a rest day slides the content day', () => {
    const state = { ...stateAt('2026-01-01'), restDays: [5] };
    // No rests before day 5 → content 1..5 sit on raw 1..5.
    expect(getCurrentDayNumber(state, '2026-01-05')).toBe(5);
    // Raw 6 is the first calendar day after the rest → content 5 continues.
    expect(getCurrentDayNumber(state, '2026-01-06')).toBe(5);
    expect(getCurrentDayNumber(state, '2026-01-07')).toBe(6);
    // The 90 content days now span 91 calendar days.
    expect(getCurrentDayNumber(state, '2026-04-01')).toBe(TOTAL_DAYS);
  });

  it('getCurrentDayNumber with stacked rests still caps at the journey limit', () => {
    const state = { ...stateAt('2026-01-01'), restDays: [5, 14, 30] };
    // content 90 plays on raw 93 (2026-04-03).
    expect(getCurrentDayNumber(state, '2026-04-03')).toBe(TOTAL_DAYS);
    expect(getCurrentDayNumber(state, '2026-04-02')).toBe(89);
  });
});

describe('engine level lookup', () => {
  it('getLevelForDay maps a day into its level range', () => {
    // Curriculum: level n spans days 3n-2 .. 3n.
    expect(getLevelForDay(1)?.id).toBe(1);
    expect(getLevelForDay(3)?.id).toBe(1);
    expect(getLevelForDay(4)?.id).toBe(2);
    expect(getLevelForDay(30)?.id).toBe(10);
    expect(getLevelForDay(90)?.id).toBe(30);
    expect(getLevelForDay(0)).toBeUndefined();
    expect(getLevelForDay(91)).toBeUndefined();
  });

  it('getLevelById returns the matching level or undefined', () => {
    expect(getLevelById(5)?.id).toBe(5);
    expect(getLevelById(0)).toBeUndefined();
    expect(getLevelById(31)).toBeUndefined();
  });
});

describe('engine cumulative task/habit lists', () => {
  it('getCumulativeTasks grows cumulatively across days', () => {
    const d1 = getCumulativeTasks(1);
    const d5 = getCumulativeTasks(5);
    expect(d1.length).toBeGreaterThan(0);
    expect(d5.length).toBeGreaterThan(d1.length);
    // First task of day 1 is the legacy ordered baseline.
    expect(d1[0].slot).toBeDefined();
    expect(d1[0].habitId).toBeDefined();
  });

  it('getCumulativeHabits includes habits active by that day', () => {
    const h1 = getCumulativeHabits(1);
    expect(h1.length).toBeGreaterThan(0);
    const h90 = getCumulativeHabits(90);
    expect(h90.length).toBeGreaterThanOrEqual(h1.length);
    expect(h1.every((h) => h.id && h.name && h.timeRequired && h.criteria)).toBe(true);
  });

  it('getHabitsByLevel only returns habits introduced at that level', () => {
    const l1 = getHabitsByLevel(1);
    expect(l1.length).toBeGreaterThan(0);
    expect(getHabitsByLevel(0)).toEqual([]);
  });

  it('getTasksByLevel returns tasks whose legacy level matches', () => {
    expect(getTasksByLevel(1).length).toBeGreaterThan(0);
    expect(getTasksByLevel(999)).toEqual([]);
  });

  it('tasksBySlot filters by slot', () => {
    const all = getCumulativeTasks(30);
    const morning = tasksBySlot(all, 'morning');
    expect(morning.length).toBeGreaterThan(0);
    expect(morning.every((t) => t.slot === 'morning')).toBe(true);
  });
});

describe('engine log helpers', () => {
  it('getDayLog returns an empty log for unknown dates and toggles round-trip', () => {
    const base = stateAt('2026-01-01');
    expect(getDayLog(base, '2026-01-01')).toEqual({});
    let s = toggleTask(base, '2026-01-01', 'd1_t1');
    expect(getDayLog(s, '2026-01-01')).toEqual({ d1_t1: true });
    s = toggleTask(s, '2026-01-01', 'd1_t1');
    expect(getDayLog(s, '2026-01-01')).toEqual({ d1_t1: false });
    // Other dates untouched.
    expect(getDayLog(s, '2026-01-02')).toEqual({});
  });

  it('completionPct rounds correctly and guards empty lists', () => {
    expect(completionPct([], {})).toBe(0);
    expect(completionPct([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { a: true, b: true })).toBe(67);
  });
});

describe('engine recovery mode', () => {
  it('is false for a fresh journey', () => {
    expect(isRecoveryModeActive(stateAt('2026-01-01'), '2026-01-01')).toBe(false);
  });

  it('splitRecoveryTasks partitions core vs bonus tasks', () => {
    const currentLevel: Level | undefined = getLevelForDay(1);
    const tasks = getCumulativeTasks(30);
    const { core, bonus } = splitRecoveryTasks(tasks, currentLevel);
    expect([...core, ...bonus]).toHaveLength(tasks.length);
    expect(core.length).toBeGreaterThan(0);
  });
});

describe('engine habit stats facade', () => {
  it('habitTasksOnDay / habitFirstActiveDay delegate to stats', () => {
    expect(habitFirstActiveDay('daily_planning')).toBe(1);
    expect(habitTasksOnDay('daily_planning', 1).length).toBeGreaterThan(0);
    expect(habitTasksOnDay('does_not_exist', 1)).toEqual([]);
  });

  it('computeHabitStreak and computeHabitScore return sensible defaults', () => {
    const state = stateAt('2026-01-01');
    expect(computeHabitStreak('daily_planning', state, '2026-01-01')).toBe(0);
    // Daily-planning is active on day 1 but nothing is done → 0% (not null).
    expect(computeHabitScore('daily_planning', state, '2026-01-01')).toBe(0);
    expect(computeHabitScore('does_not_exist', state, '2026-01-01')).toBeNull();
  });

  it('computeOverallStreak starts at 0 for an empty journey', () => {
    expect(computeOverallStreak(stateAt('2026-01-01'), '2026-01-01')).toBe(0);
  });
});

describe('engine level status', () => {
  it('every level has real (non pending-content) status handling', () => {
    for (const level of LEVELS) {
      expect(getLevelStatus(level, stateAt('2026-06-01'), 90)).not.toBe('pending-content');
    }
  });

  it('reports locked before the level starts and active inside it', () => {
    const level2 = getLevelById(2)!;
    const state = stateAt('2026-01-01');
    expect(getLevelStatus(level2, state, level2.dayStart - 1)).toBe('locked');
    expect(getLevelStatus(level2, state, level2.dayStart)).toBe('active');
    expect(getLevelStatus(level2, state, level2.dayEnd)).toBe('active');
  });

  it('reports cleared at >= 70% average completion across the level window', () => {
    const level2 = getLevelById(2)!;
    const state = stateAt('2026-01-01');
    // Complete every task of the level across its whole window, then look
    // back from PAST the level end (status is 'active' inside the window).
    for (let d = level2.dayStart; d <= level2.dayEnd; d++) {
      const dateISO = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
      const log: Record<string, boolean> = {};
      for (const t of getTasksByLevel(level2.id)) log[t.id] = true;
      state.taskLogs[dateISO] = log;
    }
    expect(getLevelStatus(level2, state, level2.dayEnd + 1)).toBe('cleared');
  });

  it('reports needs-recovery when the level average falls below 70%', () => {
    const level2 = getLevelById(2)!;
    const state = stateAt('2026-01-01');
    for (let d = level2.dayStart; d <= level2.dayEnd; d++) {
      const dateISO = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
      state.taskLogs[dateISO] = {};
    }
    expect(getLevelStatus(level2, state, level2.dayEnd + 1)).toBe('needs-recovery');
  });

  it('clears a level by mastery (5 done days) even when the window average is under 70%', () => {
    const level2 = getLevelById(2)!;
    const state = stateAt('2026-01-01');
    // Day 4 (level start) left empty → window average would be 66% (needs-recovery).
    // Days 5..9: every level task done → 5 done content days → all mastered by day 10.
    for (let d = level2.dayStart + 1; d <= level2.dayEnd + 3; d++) {
      const dateISO = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
      const log: Record<string, boolean> = {};
      for (const t of getTasksByLevel(level2.id)) log[t.id] = true;
      state.taskLogs[dateISO] = log;
    }
    expect(getLevelStatus(level2, state, level2.dayEnd + 4)).toBe('cleared');
  });
});

describe('engine review cadence', () => {
  it('week/month numbers round up', () => {
    expect(currentWeekNumber(1)).toBe(1);
    expect(currentWeekNumber(7)).toBe(1);
    expect(currentWeekNumber(8)).toBe(2);
    expect(currentMonthNumber(29)).toBe(1);
    expect(currentMonthNumber(30)).toBe(1);
    expect(currentMonthNumber(31)).toBe(2);
  });

  it('weekly review is due exactly on day 7 boundaries once', () => {
    const state = stateAt('2026-01-01');
    expect(isWeeklyReviewDue(state, 6)).toBe(false);
    expect(isWeeklyReviewDue(state, 7)).toBe(true);
    const after = {
      ...state,
      weeklyReviews: [{ weekNumber: 1, dateISO: '2026-01-07', notes: '', strongest: '', weakest: '', planForNextWeek: '' }],
    };
    expect(isWeeklyReviewDue(after, 7)).toBe(false);
    expect(isWeeklyReviewDue(after, 14)).toBe(true);
  });

  it('monthly assessment is due exactly on day 30 boundaries once', () => {
    const state = stateAt('2026-01-01');
    expect(isMonthlyAssessmentDue(state, 29)).toBe(false);
    expect(isMonthlyAssessmentDue(state, 30)).toBe(true);
    const after = {
      ...state,
      monthlyAssessments: [{ monthNumber: 1, dateISO: '2026-01-30', notes: '', reflection: '' }],
    };
    expect(isMonthlyAssessmentDue(after, 30)).toBe(false);
    expect(isMonthlyAssessmentDue(after, 60)).toBe(true);
  });

  it('missed weekly review stays due for catch-up (earliest pending first)', () => {
    const state = stateAt('2026-01-01');
    // Day 8: week 1's deadline (day 7) passed unreviewed → still due.
    expect(pendingWeeklyWeek(state, 8)).toBe(1);
    expect(isWeeklyReviewDue(state, 8)).toBe(true);
    // Day 21 with nothing reviewed → week 1 is the EARLIEST pending, not week 3.
    expect(pendingWeeklyWeek(state, 21)).toBe(1);
    expect(isWeeklyReviewDue(state, 21)).toBe(true);
  });

  it('weekly catch-up clears one week at a time in order', () => {
    const state = {
      ...stateAt('2026-01-01'),
      weeklyReviews: [{ weekNumber: 1, dateISO: '2026-01-08', strongest: '', weakest: '', planForNextWeek: '' }],
    };
    // Week 1 done late (day 8); week 2 is not due until day 14.
    expect(pendingWeeklyWeek(state, 8)).toBeNull();
    expect(isWeeklyReviewDue(state, 8)).toBe(false);
    expect(pendingWeeklyWeek(state, 15)).toBe(2);
    expect(isWeeklyReviewDue(state, 15)).toBe(true);
  });

  it('missed monthly assessment stays due for catch-up (earliest pending first)', () => {
    const state = stateAt('2026-01-01');
    expect(pendingMonthlyMonth(state, 31)).toBe(1);
    expect(isMonthlyAssessmentDue(state, 31)).toBe(true);
    // Day 61 with nothing assessed → month 1 is the earliest pending.
    expect(pendingMonthlyMonth(state, 61)).toBe(1);
    expect(isMonthlyAssessmentDue(state, 61)).toBe(true);
  });

  it('monthly catch-up clears one month at a time in order', () => {
    const state = {
      ...stateAt('2026-01-01'),
      monthlyAssessments: [{ monthNumber: 1, dateISO: '2026-01-31', reflection: '' }],
    };
    expect(pendingMonthlyMonth(state, 31)).toBeNull();
    expect(isMonthlyAssessmentDue(state, 31)).toBe(false);
    expect(pendingMonthlyMonth(state, 60)).toBe(2);
    expect(isMonthlyAssessmentDue(state, 60)).toBe(true);
  });
});

describe('engine exam month protocol', () => {
  it('daysUntilExam is null without an exam date', () => {
    expect(daysUntilExam(stateAt('2026-01-01'), '2026-01-01')).toBeNull();
    expect(isExamMonthActive(stateAt('2026-01-01'), '2026-01-01')).toBe(false);
  });

  it('isExamMonthActive only inside the 30-day window', () => {
    const state = { ...stateAt('2026-01-01'), examDateISO: '2026-02-01' };
    expect(isExamMonthActive(state, '2026-01-01')).toBe(false); // 31 days out
    expect(isExamMonthActive(state, '2026-01-02')).toBe(true); // exactly 30 days out
    expect(daysUntilExam(state, '2026-01-02')).toBe(30);
    const inside = { ...stateAt('2026-01-01'), examDateISO: '2026-02-10' };
    expect(isExamMonthActive(inside, '2026-01-15')).toBe(true);
    expect(daysUntilExam(inside, '2026-01-15')).toBe(26);
    // Past exam is not active.
    const past = { ...stateAt('2026-01-01'), examDateISO: '2025-12-01' };
    expect(isExamMonthActive(past, '2026-01-01')).toBe(false);
    expect(daysUntilExam(past, '2026-01-01')).toBeLessThan(0);
  });
});

describe('engine exports', () => {
  it('PHASES re-export matches curriculum', () => {
    expect(PHASES).toHaveLength(4);
    expect(PHASES[0].id).toBe('jee-core');
  });
});
