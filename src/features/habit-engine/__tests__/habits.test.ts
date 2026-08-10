import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { HabitStatsService } from '../habits';
import type { TaskBankEntry } from '../../../core/domain/task-bank';
import { isoAddDays, dateForContentDay } from '../dates';

function makeStats() {
  const repo = new TaskBankRepositoryImpl(
    { load: () => ({ dynamicTaskBank: [] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
    buildSeed(),
  );
  const bank = new TaskBankServiceImpl(repo);
  const stats = new HabitStatsService(bank, repo);
  return { stats, repo, bank };
}

function stateOn(startISO: string): AppState {
  return { ...emptyAppState(), startDateISO: startISO };
}

/** Marks a full completion log for every base task on the given day. */
function completeDay(state: AppState, dateISO: string, tasks: { id: string }[]): void {
  const log: Record<string, boolean> = {};
  for (const t of tasks) log[t.id] = true;
  state.taskLogs[dateISO] = log;
}

describe('HabitStatsService', () => {
  it('baseTasksForDay is deterministic and cumulative-sorted (levelId then order)', () => {
    const { stats } = makeStats();
    const day1 = stats.baseTasksForDay(1);
    expect(day1.length).toBeGreaterThan(0);
    // All unlocked by day 1 must have legacy levelId/order ordering.
    for (let i = 1; i < day1.length; i++) {
      const a = day1[i - 1].legacy!;
      const b = day1[i].legacy!;
      expect(a.levelId < b.levelId || (a.levelId === b.levelId && a.order <= b.order)).toBe(true);
    }
    // Day 90 includes strictly more tasks than day 1 (cumulative).
    expect(stats.baseTasksForDay(90).length).toBeGreaterThanOrEqual(day1.length);
  });

  it('dayLog returns an empty log for unknown dates', () => {
    const { stats } = makeStats();
    expect(stats.dayLog(stateOn('2026-01-01'), '2099-01-01')).toEqual({});
  });

  it('completionPct handles empty and partial logs', () => {
    const { stats } = makeStats();
    expect(stats.completionPct([], {})).toBe(0);
    const tasks: TaskBankEntry[] = [{ id: 'a' } as TaskBankEntry, { id: 'b' } as TaskBankEntry, { id: 'c' } as TaskBankEntry, { id: 'd' } as TaskBankEntry];
    expect(stats.completionPct(tasks, {})).toBe(0);
    expect(stats.completionPct(tasks, { a: true, b: true })).toBe(50);
    expect(stats.completionPct(tasks, { a: true, b: true, c: true, d: true })).toBe(100);
  });

  it('habitTasksOnDay only returns tasks of that habit', () => {
    const { stats } = makeStats();
    const tasks = stats.habitTasksOnDay('daily_planning', 1);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.habitId === 'daily_planning')).toBe(true);
  });

  it('habitFirstActiveDay resolves from the habit dayStart', () => {
    const { stats } = makeStats();
    expect(stats.habitFirstActiveDay('daily_planning')).toBe(1);
    expect(stats.habitFirstActiveDay('does_not_exist')).toBeNull();
  });

  it('computeHabitStreak counts consecutive fully-completed days backwards', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    // Complete daily_planning for days 3, 4, 5 but not day 2 → streak of 3 ending day 5.
    const state = stateOn(start);
    for (const day of [3, 4, 5]) {
      completeDay(state, isoAddDays(start, day - 1), stats.habitTasksOnDay('daily_planning', day));
    }
    expect(stats.computeHabitStreak('daily_planning', state, isoAddDays(start, 4), 90)).toBe(3);
    // A gap day breaks it.
    expect(stats.computeHabitStreak('daily_planning', state, isoAddDays(start, 6), 90)).toBe(0);
    expect(stats.computeHabitStreak('does_not_exist', state, isoAddDays(start, 4), 90)).toBe(0);
    expect(stats.computeHabitStreak('daily_planning', { ...emptyAppState(), startDateISO: null }, '2026-01-05', 90)).toBe(0);
  });

  it('computeHabitStreak stops before the habit becomes active', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    // daily_planning is active from day 1, so a perfect record from day 1 gives streak == day number.
    const state = stateOn(start);
    const day = 6;
    for (let d = 1; d <= day; d++) {
      completeDay(state, isoAddDays(start, d - 1), stats.habitTasksOnDay('daily_planning', d));
    }
    expect(stats.computeHabitStreak('daily_planning', state, isoAddDays(start, day - 1), 90)).toBe(day);
  });

  it('computeHabitScore is % of active days fully completed (last 7)', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    const state = stateOn(start);
    // Days 4,5,6 complete; day 7 active but incomplete; day 8 not active for this habit.
    completeDay(state, isoAddDays(start, 3), stats.habitTasksOnDay('daily_planning', 4));
    completeDay(state, isoAddDays(start, 4), stats.habitTasksOnDay('daily_planning', 5));
    completeDay(state, isoAddDays(start, 5), stats.habitTasksOnDay('daily_planning', 6));
    // 3 of 4 active days fully done (day 7 done is set below).
    completeDay(state, isoAddDays(start, 6), stats.habitTasksOnDay('daily_planning', 7));
    const score = stats.computeHabitScore('daily_planning', state, isoAddDays(start, 7));
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
  });

  it('computeHabitScore ignores rest days: the 7-day window spans 7 CONTENT days', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    const restDays = [4, 9];
    const state = { ...stateOn(start), restDays };
    // Complete content days 5,7,8,10,11,12 (6 days); content day 6 is left incomplete.
    for (const d of [5, 7, 8, 10, 11, 12]) {
      completeDay(state, dateForContentDay(d, start, restDays), stats.habitTasksOnDay('daily_planning', d));
    }
    // Window = last 7 CONTENT days (12,11,10,9,8,7,6,5 minus rest 9 → 12,11,10,8,7,6,5):
    // 6 of 7 fully done → 86%. (Calendar-7 semantics with rest-skip would only
    // see 6 active days → 83%, so this pins "rests are invisible to the window".)
    const score = stats.computeHabitScore('daily_planning', state, dateForContentDay(12, start, restDays));
    expect(score).toBe(86);
  });

  it('computeHabitStreak skips rest days without breaking the streak', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    const restDays = [9];
    const state = { ...stateOn(start), restDays };
    // Complete content days 6,7,8 then 10 — content 9 is a rest.
    for (const d of [6, 7, 8, 10]) {
      completeDay(state, dateForContentDay(d, start, restDays), stats.habitTasksOnDay('daily_planning', d));
    }
    // Walking back from content day 10: 10 ✓, 9 (rest, skipped), 8 ✓, 7 ✓, 6 ✓.
    expect(stats.computeHabitStreak('daily_planning', state, dateForContentDay(10, start, restDays), 90)).toBe(4);
    // Same completion pattern WITHOUT the rest feature: content day 9 is a
    // normal day with nothing done, so the streak breaks right after day 10.
    const noRest = stateOn(start);
    for (const d of [6, 7, 8, 10]) {
      completeDay(noRest, isoAddDays(start, d - 1), stats.habitTasksOnDay('daily_planning', d));
    }
    expect(stats.computeHabitStreak('daily_planning', noRest, isoAddDays(start, 9), 90)).toBe(1);
  });

  it('computeHabitScore returns null when there are no active days or unknown habit', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    expect(stats.computeHabitScore('does_not_exist', stateOn(start), start)).toBeNull();
    expect(stats.computeHabitScore('daily_planning', { ...emptyAppState(), startDateISO: null }, start)).toBeNull();
  });

  it('computeOverallStreak requires >= minPct completion per day', () => {
    const { stats } = makeStats();
    const start = '2026-01-01';
    const state = stateOn(start);
    // Days 1..3 fully done, day 4 partially done (only half the tasks).
    for (const day of [1, 2, 3]) {
      completeDay(state, isoAddDays(start, day - 1), stats.baseTasksForDay(day));
    }
    const day4Tasks = stats.baseTasksForDay(4);
    const partial: Record<string, boolean> = {};
    day4Tasks.slice(0, Math.ceil(day4Tasks.length / 2)).forEach((t) => (partial[t.id] = true));
    state.taskLogs[isoAddDays(start, 3)] = partial;
    // Ending day 4: days 4 (partial), 3, 2 are consecutive passes? Day 4 fails 80% → streak 0.
    expect(stats.computeOverallStreak(state, isoAddDays(start, 3), 90)).toBe(0);
    // Ending day 3: 3 perfect days → streak 3.
    expect(stats.computeOverallStreak(state, isoAddDays(start, 2), 90)).toBe(3);
    expect(stats.computeOverallStreak({ ...emptyAppState(), startDateISO: null }, start, 90)).toBe(0);
  });
});
