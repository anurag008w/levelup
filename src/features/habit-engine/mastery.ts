import type { AppState } from '../../core/domain/state';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { TaskBankService } from '../task-bank/task-bank.service';
import { dateForContentDay } from './dates';

/**
 * Task mastery (the "completed" bucket).
 *
 * A task is MASTERED once it has been completed on 5 content days, with a
 * grace rule: ONE missed day is tolerated (count is kept), a SECOND
 * consecutive missed day resets the count to 0. Rest days are skipped
 * entirely (the task is not expected on a rest day).
 *
 * Once mastered, the task leaves the daily rotation and lives in the
 * "Completed (mastered)" section of the Today screen. It stays there forever
 * unless the user manually moves it to a specific day (or back). See
 * `state.masteryPlacement`.
 *
 * Mastery is evaluated from the persisted task logs on PAST days only — today
 * is still in progress, so it never counts as a done or a miss yet. That gives
 * the "done 5 days → from the next day it appears in the completed section"
 * behaviour the user described.
 *
 * Only DAILY repeating tasks are mastery-eligible. One-off tasks (day-exact,
 * weekly cadence, mocks, exam-window checklists) never master.
 */

export const MASTERY_THRESHOLD = 5;

export interface MasteryState {
  /** Done-day count toward mastery. */
  count: number;
  /** Content day on which mastery was reached (null = not mastered yet). */
  masteredAtDay: number | null;
  /** Consecutive missed days (resets count when it reaches 2). */
  consecutiveMisses: number;
}

export type MasteryEligibility = 'daily' | 'one-off';

/** A task is mastery-eligible only when it repeats daily. */
export function masteryEligibility(entry: TaskBankEntry): MasteryEligibility {
  const has = (type: string) => entry.unlockConditions.some((c) => c.type === type);
  if (has('day-exact') || has('day-in') || has('weekday') || has('mock-sunday') || has('exam-window')) return 'one-off';
  return 'daily';
}

/** The content day from which a daily task is expected (max of all fromDay). */
export function taskUnlockDay(entry: TaskBankEntry): number {
  const fromDays = entry.unlockConditions.filter((c) => c.type === 'day').map((c) => c.fromDay);
  return fromDays.length > 0 ? Math.max(...fromDays) : 1;
}

/**
 * Mastery state of a task evaluated over PAST content days
 * (`unlockDay .. todayContentDay - 1`). Deterministic — pure function of the
 * persisted logs, never mutates state.
 */
export function computeTaskMastery(
  state: AppState,
  entry: TaskBankEntry,
  todayContentDay: number,
): MasteryState {
  const startDateISO = state.startDateISO;
  if (!startDateISO) return { count: 0, masteredAtDay: null, consecutiveMisses: 0 };
  if (masteryEligibility(entry) === 'one-off') return { count: 0, masteredAtDay: null, consecutiveMisses: 0 };

  const restDays = state.restDays ?? [];
  const unlockDay = taskUnlockDay(entry);
  let count = 0;
  let consecutiveMisses = 0;
  for (let c = unlockDay; c < todayContentDay; c++) {
    if (restDays.includes(c)) continue;
    const dateISO = dateForContentDay(c, startDateISO, restDays);
    const log = state.taskLogs[dateISO] ?? {};
    if (log[entry.id]) {
      count++;
      consecutiveMisses = 0;
      if (count >= MASTERY_THRESHOLD) {
        return { count, masteredAtDay: c, consecutiveMisses: 0 };
      }
    } else {
      consecutiveMisses++;
      if (consecutiveMisses >= 2) {
        count = 0;
        consecutiveMisses = 0;
      }
    }
  }
  return { count, masteredAtDay: null, consecutiveMisses };
}

/**
 * Effective bucket of a task for a given content day, combining the computed
 * mastery with any manual placement override:
 *  - manual "scheduled for today"  → the task is in TODAY's plan
 *  - manual "scheduled for another day" → it sits in the completed bucket
 *    (the schedule is a one-shot; after its day it returns to completed)
 *  - manual "completed" or computed-mastered → completed bucket
 *  - otherwise → normal rotation
 */
export type TaskBucket = 'completed' | 'scheduled-today' | 'normal';

export function effectiveBucket(
  placement: { bucket: 'completed' } | { bucket: 'scheduled'; day: number } | undefined,
  isComputedMastered: boolean,
  todayContentDay: number,
): TaskBucket {
  if (placement?.bucket === 'scheduled') {
    return placement.day === todayContentDay ? 'scheduled-today' : 'completed';
  }
  if (placement?.bucket === 'completed') return 'completed';
  return isComputedMastered ? 'completed' : 'normal';
}

export interface MasterySummary {
  /** Content day of the queried date. */
  dayNumber: number;
  /** All mastery-eligible entries (legacy daily + dynamic), keyed by id. */
  entriesById: Map<string, TaskBankEntry>;
  /** Mastery state per entry id. */
  masteryById: Map<string, MasteryState>;
  /** ids that have reached mastery (masteredAtDay != null). */
  masteredIds: string[];
}

/** Computes mastery across every mastery-eligible task in the journey. */
export function computeMasterySummary(
  state: AppState,
  todayContentDay: number,
  baseTasksForDay: (dayNumber: number) => TaskBankEntry[],
): MasterySummary {
  const entriesById = new Map<string, TaskBankEntry>();
  const candidates = [...baseTasksForDay(Math.max(90, todayContentDay)), ...(state.dynamicTaskBank ?? [])];
  for (const e of candidates) {
    if (masteryEligibility(e) === 'one-off') continue;
    if (!entriesById.has(e.id)) entriesById.set(e.id, e);
  }
  const masteryById = new Map<string, MasteryState>();
  const masteredIds: string[] = [];
  for (const [id, entry] of entriesById) {
    const m = computeTaskMastery(state, entry, todayContentDay);
    masteryById.set(id, m);
    if (m.masteredAtDay !== null) masteredIds.push(id);
  }
  return { dayNumber: todayContentDay, entriesById, masteryById, masteredIds };
}

export interface LevelMasteryResult {
  /** level ids whose EVERY authored task is mastered. */
  clearedByMastery: number[];
}

/** Levels fully mastered (every task of the level reached mastery). */
export function computeLevelsClearedByMastery(
  state: AppState,
  todayContentDay: number,
  taskBank: TaskBankService,
  levels: { id: number; authored: boolean }[],
): LevelMasteryResult {
  const clearedByMastery: number[] = [];
  for (const level of levels) {
    if (!level.authored) continue;
    const levelTasks = taskBank.findByLevel(level.id);
    if (levelTasks.length === 0) continue;
    if (levelTasks.every((t) => computeTaskMastery(state, t, todayContentDay).masteredAtDay !== null)) {
      clearedByMastery.push(level.id);
    }
  }
  return { clearedByMastery };
}
