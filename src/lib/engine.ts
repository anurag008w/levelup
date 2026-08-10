import { LEVELS, PHASES, TOTAL_DAYS } from '../data/curriculum';
import type { AppState, DayLog, Level, Slot } from '../types';
import type { TaskBankEntry } from '../core/domain/task-bank';
import type { Habit as CoreHabit } from '../core/domain/habit';
import { DEFAULT_PROGRESSION_CONFIG } from '../core/domain/progress';
import { contentDayForDate, dateForContentDay, dateToISO, isoAddDays, rawDayNumberForDate } from '../features/habit-engine/dates';
import { computeTaskMastery } from '../features/habit-engine/mastery';
import { HabitProgressionService } from '../features/habit-engine/planner';
import type { TaskBankService } from '../features/task-bank/task-bank.service';
import { TaskBankServiceImpl } from '../features/task-bank/task-bank.service';
import { buildSeed, TaskBankRepositoryImpl } from '../features/task-bank/task-bank.repository';

// Backward-compatible facade over the new Habit Progression Engine.
// Keeps the exact old function signatures so the legacy screens keep working
// while the data flows from the Task Bank. The seed-only repository below
// reproduces the historical curriculum byte-for-byte.

// ---- Legacy shapes (kept for the existing screens) ----

export interface DailyTask {
  id: string;
  slot: Slot;
  text: string;
  habitId: string;
}

export interface Habit {
  id: string;
  name: string;
  timeRequired: string;
  criteria: string;
}

export type LevelStatus = 'locked' | 'active' | 'cleared' | 'needs-recovery' | 'pending-content';

const MS_DAY = 24 * 60 * 60 * 1000;

const seedRepo = new TaskBankRepositoryImpl(
  { load: () => ({ dynamicTaskBank: [] } as unknown as AppState), save: () => undefined, clear: () => undefined },
  buildSeed(),
);
const seedTaskBank: TaskBankService = new TaskBankServiceImpl(seedRepo);
const progression = new HabitProgressionService({
  taskBank: seedTaskBank,
  habits: seedRepo,
  levels: LEVELS,
  totalDays: TOTAL_DAYS,
});

function toLegacyTask(t: TaskBankEntry): DailyTask {
  return {
    id: t.id,
    slot: t.legacy?.slot ?? 'blocks',
    text: t.title,
    habitId: t.habitId,
  };
}

function toLegacyHabit(h: CoreHabit): Habit {
  return { id: h.id, name: h.name, timeRequired: h.timeRequired, criteria: h.criteria };
}

export { dateToISO, isoAddDays, rawDayNumberForDate };

// ---- Day numbers & level lookup ----

export function getCurrentDayNumber(state: AppState, todayISO: string): number {
  if (!state.startDateISO) return 0;
  const content = contentDayForDate(todayISO, state.startDateISO, state.restDays ?? []);
  return Math.min(Math.max(content, 1), getJourneyDayLimit(state));
}

export function getJourneyDayLimit(state: AppState): number {
  const dynamicMax = Math.max(
    0,
    ...state.dynamicTaskBank.flatMap((entry) =>
      entry.unlockConditions.flatMap((condition) => {
        if (condition.type === 'day') return [condition.fromDay];
        if (condition.type === 'day-exact' || condition.type === 'not-day') return [condition.day];
        if (condition.type === 'day-in') return condition.days;
        return [];
      }),
    ),
  );
  const postJourneyMax = state.postJourney?.journeyComplete ? TOTAL_DAYS + state.postJourney.extensionDays : 0;
  return Math.max(TOTAL_DAYS, dynamicMax, postJourneyMax);
}

export function getLevelForDay(dayNumber: number): Level | undefined {
  return LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd);
}

export function getLevelById(id: number): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---- Task lists (cumulative, seed-only — exact legacy behaviour) ----

export function getCumulativeTasks(dayNumber: number): DailyTask[] {
  return progression.stats.baseTasksForDay(dayNumber).map(toLegacyTask);
}

export function getCumulativeHabits(dayNumber: number): Habit[] {
  return seedRepo
    .getAllHabits()
    .filter((h) => h.dayStart <= dayNumber)
    .map(toLegacyHabit);
}

export function getHabitsByLevel(levelId: number): Habit[] {
  return seedRepo.getHabitsByLevel(levelId).map(toLegacyHabit);
}

export function getTasksByLevel(levelId: number): DailyTask[] {
  return seedTaskBank.findByLevel(levelId).map(toLegacyTask);
}

export function tasksBySlot(tasks: DailyTask[], slot: Slot): DailyTask[] {
  return tasks.filter((t) => t.slot === slot);
}

// ---- Log helpers ----

export function getDayLog(state: AppState, dateISO: string): DayLog {
  return state.taskLogs[dateISO] ?? {};
}

export function toggleTask(state: AppState, dateISO: string, taskId: string): AppState {
  const log = { ...(state.taskLogs[dateISO] ?? {}) };
  log[taskId] = !log[taskId];
  return { ...state, taskLogs: { ...state.taskLogs, [dateISO]: log } };
}

export function completionPct(tasks: Array<{ id: string }>, log: DayLog): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => log[t.id]).length;
  return Math.round((done / tasks.length) * 100);
}

// ---- Recovery Mode ----

export function isRecoveryModeActive(state: AppState, todayISO: string): boolean {
  return progression.buildContext(state, todayISO, DEFAULT_PROGRESSION_CONFIG).recoveryMode;
}

export function splitRecoveryTasks(tasks: DailyTask[], currentLevel: Level | undefined) {
  const coreIds = new Set(seedTaskBank.findByLevel(currentLevel?.id ?? 0).map((t) => t.id));
  return {
    core: tasks.filter((t) => coreIds.has(t.id)),
    bonus: tasks.filter((t) => !coreIds.has(t.id)),
  };
}

// ---- Habit streak & score ----

export function habitTasksOnDay(habitId: string, dayNumber: number): DailyTask[] {
  return progression.stats.habitTasksOnDay(habitId, dayNumber).map(toLegacyTask);
}

export function habitFirstActiveDay(habitId: string): number | null {
  return progression.stats.habitFirstActiveDay(habitId);
}

export function computeHabitStreak(habitId: string, state: AppState, todayISO: string): number {
  return progression.stats.computeHabitStreak(habitId, state, todayISO, TOTAL_DAYS);
}

export function computeHabitScore(habitId: string, state: AppState, todayISO: string): number | null {
  return progression.stats.computeHabitScore(habitId, state, todayISO);
}

export function computeOverallStreak(state: AppState, todayISO: string): number {
  return progression.stats.computeOverallStreak(state, todayISO, TOTAL_DAYS);
}

// ---- Level status ----

export function getLevelStatus(level: Level, state: AppState, currentDayNumber: number): LevelStatus {
  if (!level.authored) return 'pending-content';
  if (currentDayNumber < level.dayStart) return 'locked';
  if (currentDayNumber <= level.dayEnd) return 'active';
  if (!state.startDateISO) return 'locked';
  const levelTasks = seedTaskBank.findByLevel(level.id);
  if (levelTasks.length === 0) return 'needs-recovery';
  // Auto-clear: every task of the level reached mastery (per-level check —
  // avoids recomputing the whole journey's mastery for each level).
  if (levelTasks.every((t) => computeTaskMastery(state, t, currentDayNumber).masteredAtDay !== null)) return 'cleared';
  let total = 0;
  const restDays = state.restDays ?? [];
  for (let d = level.dayStart; d <= level.dayEnd; d++) {
    const dateISO = dateForContentDay(d, state.startDateISO, restDays);
    const log = getDayLog(state, dateISO);
    total += completionPct(levelTasks, log);
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

export { PHASES };
