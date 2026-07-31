import { LEVELS, TOTAL_DAYS } from '../data/curriculum';
import type { AppState, DailyTask, DayLog, Habit, Level, Slot } from '../types';

const MS_DAY = 24 * 60 * 60 * 1000;

export function dateToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateToISO(d);
}

// Raw day number (1-indexed) for any calendar date, relative to start date.
// Deterministic and stable — never remapped — so history stays consistent.
export function rawDayNumberForDate(dateISO: string, startDateISO: string): number {
  const start = new Date(startDateISO + 'T00:00:00').getTime();
  const day = new Date(dateISO + 'T00:00:00').getTime();
  return Math.floor((day - start) / MS_DAY) + 1;
}

export function getCurrentDayNumber(state: AppState, todayISO: string): number {
  if (!state.startDateISO) return 0;
  const raw = rawDayNumberForDate(todayISO, state.startDateISO);
  return Math.min(Math.max(raw, 1), TOTAL_DAYS);
}

export function getLevelForDay(dayNumber: number): Level | undefined {
  return LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd);
}

export function getLevelById(id: number): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

// All tasks introduced by every authored level unlocked so far (cumulative).
export function getCumulativeTasks(dayNumber: number): DailyTask[] {
  return LEVELS.filter((l) => l.authored && l.dayStart <= dayNumber).flatMap((l) => l.dailyTasks);
}

export function getCumulativeHabits(dayNumber: number): Habit[] {
  return LEVELS.filter((l) => l.authored && l.dayStart <= dayNumber).flatMap((l) => l.newHabits);
}

export function tasksBySlot(tasks: DailyTask[], slot: Slot): DailyTask[] {
  return tasks.filter((t) => t.slot === slot);
}

export function getDayLog(state: AppState, dateISO: string): DayLog {
  return state.taskLogs[dateISO] ?? {};
}

export function toggleTask(state: AppState, dateISO: string, taskId: string): AppState {
  const log = { ...(state.taskLogs[dateISO] ?? {}) };
  log[taskId] = !log[taskId];
  return { ...state, taskLogs: { ...state.taskLogs, [dateISO]: log } };
}

export function completionPct(tasks: DailyTask[], log: DayLog): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => log[t.id]).length;
  return Math.round((done / tasks.length) * 100);
}

// ---- Recovery Mode: triggers when yesterday's completion was very low ----
export function isRecoveryModeActive(state: AppState, todayISO: string): boolean {
  if (!state.startDateISO) return false;
  const yesterday = isoAddDays(todayISO, -1);
  const yDayNum = rawDayNumberForDate(yesterday, state.startDateISO);
  if (yDayNum < 1) return false;
  const tasks = getCumulativeTasks(yDayNum);
  if (tasks.length === 0) return false;
  const pct = completionPct(tasks, getDayLog(state, yesterday));
  return pct < 30;
}

// In recovery mode, only the CURRENT level's tasks are "required" — everything
// from earlier levels becomes optional/bonus for the day, to rebuild momentum.
export function splitRecoveryTasks(tasks: DailyTask[], currentLevel: Level | undefined) {
  const coreIds = new Set((currentLevel?.dailyTasks ?? []).map((t) => t.id));
  return {
    core: tasks.filter((t) => coreIds.has(t.id)),
    bonus: tasks.filter((t) => !coreIds.has(t.id)),
  };
}

// ---- Habit streak & score ----
export function habitTasksOnDay(habitId: string, dayNumber: number): DailyTask[] {
  return getCumulativeTasks(dayNumber).filter((t) => t.habitId === habitId);
}

export function habitFirstActiveDay(habitId: string): number | null {
  const lvl = LEVELS.find((l) => l.authored && l.newHabits.some((h) => h.id === habitId));
  return lvl ? lvl.dayStart : null;
}

export function computeHabitStreak(habitId: string, state: AppState, todayISO: string): number {
  if (!state.startDateISO) return 0;
  const firstActive = habitFirstActiveDay(habitId);
  if (firstActive === null) return 0;
  let streak = 0;
  let cursor = todayISO;
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const dayNum = rawDayNumberForDate(cursor, state.startDateISO);
    if (dayNum < firstActive) break;
    const tasks = habitTasksOnDay(habitId, dayNum);
    if (tasks.length === 0) break;
    const log = getDayLog(state, cursor);
    const allDone = tasks.every((t) => log[t.id]);
    if (!allDone) break;
    streak++;
    cursor = isoAddDays(cursor, -1);
  }
  return streak;
}

// % of active days (last 7) where this habit was fully completed
export function computeHabitScore(habitId: string, state: AppState, todayISO: string): number | null {
  if (!state.startDateISO) return null;
  const firstActive = habitFirstActiveDay(habitId);
  if (firstActive === null) return null;
  let activeDays = 0;
  let successDays = 0;
  let cursor = todayISO;
  for (let i = 0; i < 7; i++) {
    const dayNum = rawDayNumberForDate(cursor, state.startDateISO);
    if (dayNum < firstActive) break;
    const tasks = habitTasksOnDay(habitId, dayNum);
    if (tasks.length > 0) {
      activeDays++;
      const log = getDayLog(state, cursor);
      if (tasks.every((t) => log[t.id])) successDays++;
    }
    cursor = isoAddDays(cursor, -1);
  }
  if (activeDays === 0) return null;
  return Math.round((successDays / activeDays) * 100);
}

export function computeOverallStreak(state: AppState, todayISO: string): number {
  if (!state.startDateISO) return 0;
  let streak = 0;
  let cursor = todayISO;
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const dayNum = rawDayNumberForDate(cursor, state.startDateISO);
    if (dayNum < 1) break;
    const tasks = getCumulativeTasks(dayNum);
    if (tasks.length === 0) break;
    const pct = completionPct(tasks, getDayLog(state, cursor));
    if (pct < 80) break;
    streak++;
    cursor = isoAddDays(cursor, -1);
  }
  return streak;
}

// ---- Level status ----
export type LevelStatus = 'locked' | 'active' | 'cleared' | 'needs-recovery' | 'pending-content';

export function getLevelStatus(level: Level, state: AppState, currentDayNumber: number): LevelStatus {
  if (!level.authored) return 'pending-content';
  if (currentDayNumber < level.dayStart) return 'locked';
  if (currentDayNumber <= level.dayEnd) return 'active';
  // level window has passed — evaluate
  if (!state.startDateISO) return 'locked';
  let total = 0;
  for (let d = level.dayStart; d <= level.dayEnd; d++) {
    const dateISO = isoAddDays(state.startDateISO, d - 1);
    const log = getDayLog(state, dateISO);
    total += completionPct(level.dailyTasks, log);
  }
  const avg = total / (level.dayEnd - level.dayStart + 1);
  return avg >= 70 ? 'cleared' : 'needs-recovery';
}

// ---- Weekly / monthly review cadence ----
export function currentWeekNumber(dayNumber: number): number {
  return Math.ceil(dayNumber / 7);
}
export function currentMonthNumber(dayNumber: number): number {
  return Math.ceil(dayNumber / 30);
}
export function isWeeklyReviewDue(state: AppState, dayNumber: number): boolean {
  if (dayNumber < 7) return false;
  const wk = currentWeekNumber(dayNumber);
  return !state.weeklyReviews.some((r) => r.weekNumber === wk) && dayNumber % 7 === 0;
}
export function isMonthlyAssessmentDue(state: AppState, dayNumber: number): boolean {
  if (dayNumber < 30) return false;
  const mo = currentMonthNumber(dayNumber);
  return !state.monthlyAssessments.some((r) => r.monthNumber === mo) && dayNumber % 30 === 0;
}

// ---- Exam Month Protocol ----
export function isExamMonthActive(state: AppState, todayISO: string): boolean {
  if (!state.examDateISO) return false;
  const today = new Date(todayISO + 'T00:00:00').getTime();
  const exam = new Date(state.examDateISO + 'T00:00:00').getTime();
  const daysLeft = Math.round((exam - today) / MS_DAY);
  return daysLeft >= 0 && daysLeft <= 30;
}

export function daysUntilExam(state: AppState, todayISO: string): number | null {
  if (!state.examDateISO) return null;
  const today = new Date(todayISO + 'T00:00:00').getTime();
  const exam = new Date(state.examDateISO + 'T00:00:00').getTime();
  return Math.round((exam - today) / MS_DAY);
}
