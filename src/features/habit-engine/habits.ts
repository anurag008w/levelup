import type { AppState } from '../../core/domain/state';
import type { DayLog } from '../../core/domain/progress';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { HabitRepository } from '../../core/ports/repositories';
import type { TaskBankService } from '../task-bank/task-bank.service';
import { isoAddDays, rawDayNumberForDate } from './dates';

/**
 * Habit statistics over the Task Bank. Produces identical results to the old
 * hardcoded engine for the same data (backward-compatibility guarantee).
 */
export class HabitStatsService {
  private readonly taskBank: TaskBankService;
  private readonly habits: HabitRepository;

  constructor(taskBank: TaskBankService, habits: HabitRepository) {
    this.taskBank = taskBank;
    this.habits = habits;
  }

  /** The deterministic legacy base set of tasks for a day (day-unlock entries). */
  baseTasksForDay(dayNumber: number): TaskBankEntry[] {
    return this.taskBank
      .search({
        unlock: { dayNumber, phase: 'jee-core', unlockedHabitIds: [], examWindowActive: false, mockSunday: false, recoveryMode: false, backlogDays: 0, revisionDueHabitIds: [] },
      })
      .filter((t) => t.unlockConditions.every((c) => c.type !== 'day' || c.fromDay <= dayNumber))
      .sort((a, b) => {
        const la = a.legacy?.levelId ?? 0;
        const lb = b.legacy?.levelId ?? 0;
        return la - lb || (a.legacy?.order ?? 0) - (b.legacy?.order ?? 0);
      });
  }

  dayLog(state: AppState, dateISO: string): DayLog {
    return state.taskLogs[dateISO] ?? {};
  }

  completionPct(tasks: TaskBankEntry[], log: DayLog): number {
    if (tasks.length === 0) return 0;
    const done = tasks.filter((t) => log[t.id]).length;
    return Math.round((done / tasks.length) * 100);
  }

  habitTasksOnDay(habitId: string, dayNumber: number): TaskBankEntry[] {
    return this.baseTasksForDay(dayNumber).filter((t) => t.habitId === habitId);
  }

  habitFirstActiveDay(habitId: string): number | null {
    const habit = this.habits.getHabitById(habitId);
    return habit ? habit.dayStart : null;
  }

  /** Consecutive fully-completed days for a habit, ending today. */
  computeHabitStreak(habitId: string, state: AppState, todayISO: string, totalDays: number): number {
    if (!state.startDateISO) return 0;
    const firstActive = this.habitFirstActiveDay(habitId);
    if (firstActive === null) return 0;
    let streak = 0;
    let cursor = todayISO;
    for (let i = 0; i < totalDays; i++) {
      const dayNum = rawDayNumberForDate(cursor, state.startDateISO);
      if (dayNum < firstActive) break;
      const tasks = this.habitTasksOnDay(habitId, dayNum);
      if (tasks.length === 0) break;
      const allDone = tasks.every((t) => this.dayLog(state, cursor)[t.id]);
      if (!allDone) break;
      streak++;
      cursor = isoAddDays(cursor, -1);
    }
    return streak;
  }

  /** % of active days (last 7) where the habit was fully completed. */
  computeHabitScore(habitId: string, state: AppState, todayISO: string): number | null {
    if (!state.startDateISO) return null;
    const firstActive = this.habitFirstActiveDay(habitId);
    if (firstActive === null) return null;
    let activeDays = 0;
    let successDays = 0;
    let cursor = todayISO;
    for (let i = 0; i < 7; i++) {
      const dayNum = rawDayNumberForDate(cursor, state.startDateISO);
      if (dayNum < firstActive) break;
      const tasks = this.habitTasksOnDay(habitId, dayNum);
      if (tasks.length > 0) {
        activeDays++;
        const log = this.dayLog(state, cursor);
        if (tasks.every((t) => log[t.id])) successDays++;
      }
      cursor = isoAddDays(cursor, -1);
    }
    if (activeDays === 0) return null;
    return Math.round((successDays / activeDays) * 100);
  }

  /** Overall streak: consecutive days with >= 80% completion. */
  computeOverallStreak(state: AppState, todayISO: string, totalDays: number, minPct = 80): number {
    if (!state.startDateISO) return 0;
    let streak = 0;
    let cursor = todayISO;
    for (let i = 0; i < totalDays; i++) {
      const dayNum = rawDayNumberForDate(cursor, state.startDateISO);
      if (dayNum < 1) break;
      const tasks = this.baseTasksForDay(dayNum);
      if (tasks.length === 0) break;
      const pct = this.completionPct(tasks, this.dayLog(state, cursor));
      if (pct < minPct) break;
      streak++;
      cursor = isoAddDays(cursor, -1);
    }
    return streak;
  }
}
