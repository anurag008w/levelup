import type { AppState } from '../../core/domain/state';
import type { PlanningContext, ProgressionConfig } from '../../core/domain/progress';
import type { Level } from '../../core/domain/habit';
import type { HabitRepository } from '../../core/ports/repositories';
import type { HabitStatsService } from './habits';
import { rawDayNumberForDate, isoAddDays } from './dates';

export interface ContextDeps {
  stats: HabitStatsService;
  habits: HabitRepository;
  levels: Level[];
  totalDays: number;
}

/**
 * Aggregates everything the planner needs for a day: streaks, missed tasks,
 * weak/strong habits, backlog, revision schedule, workload, gaps, summaries.
 * Deterministic — no randomness, no hardcoded lists.
 */
export function buildPlanningContext(
  state: AppState,
  dateISO: string,
  config: ProgressionConfig,
  deps: ContextDeps,
): PlanningContext {
  const { stats, habits, levels, totalDays } = deps;
  if (!state.startDateISO) {
    throw new Error('Cannot plan without a journey start date');
  }

  const rawDayNumber = rawDayNumberForDate(dateISO, state.startDateISO);
  const dynamicMaxDay = Math.max(
    totalDays,
    ...state.dynamicTaskBank.flatMap((entry) =>
      entry.unlockConditions.flatMap((condition) => {
        if (condition.type === 'day') return [condition.fromDay];
        if (condition.type === 'day-exact' || condition.type === 'not-day') return [condition.day];
        if (condition.type === 'day-in') return condition.days;
        return [];
      }),
    ),
  );
  const postJourneyMaxDay = state.postJourney?.journeyComplete ? totalDays + state.postJourney.extensionDays : totalDays;
  const dayLimit = Math.max(totalDays, dynamicMaxDay, postJourneyMaxDay);
  const dayNumber = Math.min(Math.max(rawDayNumber, 1), dayLimit);

  const unlockedHabitIds = habits
    .getAllHabits()
    .filter((h) => h.dayStart <= dayNumber)
    .map((h) => h.id);

  // Completed / missed tasks over the last 7 days (excluding today).
  const completedTaskIds = new Set<string>();
  const missedTaskIds = new Set<string>();
  let backlogDays = 0;
  let cursor = isoAddDays(dateISO, -1);
  for (let i = 0; i < 14; i++) {
    const dNum = rawDayNumberForDate(cursor, state.startDateISO);
    if (dNum < 1) break;
    const tasks = stats.baseTasksForDay(dNum);
    if (tasks.length === 0) {
      cursor = isoAddDays(cursor, -1);
      continue;
    }
    const log = stats.dayLog(state, cursor);
    let doneCount = 0;
    for (const t of tasks) {
      if (log[t.id]) {
        doneCount++;
        completedTaskIds.add(t.id);
      } else {
        missedTaskIds.add(t.id);
      }
    }
    const pct = Math.round((doneCount / tasks.length) * 100);
    if (pct < config.missedThresholdPct) backlogDays++;
    cursor = isoAddDays(cursor, -1);
  }

  // Gap detection: consecutive low-completion days ending yesterday.
  let gapDays = 0;
  cursor = isoAddDays(dateISO, -1);
  for (let i = 0; i < totalDays; i++) {
    const dNum = rawDayNumberForDate(cursor, state.startDateISO);
    if (dNum < 1) break;
    const tasks = stats.baseTasksForDay(dNum);
    if (tasks.length === 0) break;
    const pct = stats.completionPct(tasks, stats.dayLog(state, cursor));
    if (pct < config.missedThresholdPct) {
      gapDays++;
      cursor = isoAddDays(cursor, -1);
    } else {
      break;
    }
  }

  const overallStreak = stats.computeOverallStreak(state, dateISO, totalDays);

  // Weak / strong habits from last-7-day scores + persisted summaries.
  const weakHabitIds = new Set<string>();
  const strongHabitIds = new Set<string>();
  for (const habit of habits.getAllHabits()) {
    if (habit.dayStart > dayNumber) continue;
    const score = stats.computeHabitScore(habit.id, state, dateISO);
    if (score !== null && score < 50) weakHabitIds.add(habit.id);
    if (score !== null && score >= 80) strongHabitIds.add(habit.id);
  }

  const recentSummaries = [...state.summaries]
    .filter((s) => s.dateISO < dateISO)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .slice(0, 3);
  for (const s of recentSummaries) {
    for (const id of s.weakHabitIds) weakHabitIds.add(id);
    for (const id of s.strongHabitIds) strongHabitIds.add(id);
  }

  // Revision schedule: habit's review-suitable tasks not done in the last
  // `dueAfterDays` days → revision is due.
  const revisionDueHabitIds = new Set<string>();
  for (const habit of habits.getAllHabits()) {
    if (habit.dayStart > dayNumber) continue;
    const reviewTasks = stats.baseTasksForDay(dayNumber).filter(
      (t) => t.habitId === habit.id && (t.taskType === 'Review' || t.revisionSuitability >= 0.7),
    );
    if (reviewTasks.length === 0) continue;
    let lastDone = -1;
    cursor = isoAddDays(dateISO, -1);
    for (let i = 0; i < 7; i++) {
      const dNum = rawDayNumberForDate(cursor, state.startDateISO);
      if (dNum < 1) break;
      const log = stats.dayLog(state, cursor);
      if (reviewTasks.some((t) => log[t.id])) {
        lastDone = i;
        break;
      }
      cursor = isoAddDays(cursor, -1);
    }
    if (lastDone === -1 || lastDone >= 3) revisionDueHabitIds.add(habit.id);
  }

  const level = getLevelForDay(levels, dayNumber);
  const examWindowActive = isExamMonthActive(state, dateISO);

  const date = new Date(dateISO + 'T00:00:00');
  const weekday = date.getDay(); // 0 = Sunday, matches JS Date.getDay()

  let jeeWorkload = 0.3 + (dayNumber / totalDays) * 0.2;
  if (examWindowActive) jeeWorkload += 0.3;
  if (backlogDays >= 2) jeeWorkload += 0.2;
  jeeWorkload = Math.max(0, Math.min(1, jeeWorkload));

  const recoveryMode = isRecoveryModeActive(state, dateISO, config, deps);

  const restDay = (state.restDays ?? []).includes(dayNumber);
  // A day is a MOCK test day ONLY when explicitly marked via setDayMode
  // (mode:"test"). Sundays are normal study days by default.
  const mockSunday = (state.testDays ?? []).includes(dayNumber);

  return {
    dateISO,
    dayNumber,
    phase: level?.phase ?? 'jee-core',
    unlockedHabitIds,
    completedTaskIds,
    missedTaskIds,
    streak: overallStreak,
    weakHabitIds: [...weakHabitIds],
    strongHabitIds: [...strongHabitIds],
    jeeWorkload,
    backlogDays,
    revisionDueHabitIds: [...revisionDueHabitIds],
    availableMinutes: state.studyTimeMinutes > 0 ? state.studyTimeMinutes : config.availableMinutes,
    recoveryMode,
    examWindowActive,
    mockSunday,
    weekday,
    restDay,
    gapDays,
    recentSummaries,
    dynamicEntries: state.dynamicTaskBank,
  };
}

export function getLevelForDay(levels: Level[], dayNumber: number): Level | undefined {
  return levels.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd);
}

function isExamMonthActive(state: AppState, dateISO: string): boolean {
  if (!state.examDateISO) return false;
  const today = new Date(dateISO + 'T00:00:00').getTime();
  const exam = new Date(state.examDateISO + 'T00:00:00').getTime();
  const daysLeft = Math.round((exam - today) / (24 * 60 * 60 * 1000));
  return daysLeft >= 0 && daysLeft <= 30;
}

/**
 * Recovery mode lifecycle (user-defined spec):
 *   - ENTER: 3 CONSECUTIVE missed days (completion < recoveryThresholdPct).
 *   - STAY:  recovery keeps running while the user is not "back on track",
 *     i.e. until a day reaches RECOVERY_EXIT_PCT completion. Partial days
 *     (30–69%) break the miss streak but do NOT end recovery.
 *   - EXIT:  the morning after a day at/above RECOVERY_EXIT_PCT.
 *   - RE-ARM: another 3 consecutive missed days turns recovery on again.
 */
const RECOVERY_TRIGGER_MISS_DAYS = 3;
const RECOVERY_EXIT_PCT = 70;

function isRecoveryModeActive(state: AppState, dateISO: string, config: ProgressionConfig, deps: ContextDeps): boolean {
  if (!state.startDateISO) return false;
  // Scan backwards from yesterday: a recent fully-on-track day means recovery
  // is off (and must have been off ever since — we can stop there). Otherwise
  // count consecutive missed days; 3 of them (no on-track day in between)
  // activate recovery for today.
  let consecutiveMiss = 0;
  let cursor = isoAddDays(dateISO, -1);
  for (let i = 0; i < deps.totalDays; i++) {
    const dNum = rawDayNumberForDate(cursor, state.startDateISO);
    if (dNum < 1) break;
    const tasks = deps.stats.baseTasksForDay(dNum);
    if (tasks.length === 0) break;
    const pct = deps.stats.completionPct(tasks, deps.stats.dayLog(state, cursor));
    // Back on track → recovery ends. Since we scan newest-first, any newer
    // day already failed the ≥70% check, so returning here is correct.
    if (pct >= RECOVERY_EXIT_PCT) return false;
    if (pct < config.recoveryThresholdPct) {
      consecutiveMiss++;
      if (consecutiveMiss >= RECOVERY_TRIGGER_MISS_DAYS) return true;
    } else {
      // Partial day: resets the miss streak but keeps recovery running if it
      // was already active (track pe nahi aaye).
      consecutiveMiss = 0;
    }
    cursor = isoAddDays(cursor, -1);
  }
  return false;
}
