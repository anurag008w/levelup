import { LEVELS, TOTAL_DAYS } from '../../data/curriculum';
import { DEFAULT_PROGRESSION_CONFIG } from '../../core/domain/progress';
import type { AppState } from '../../core/domain/state';
import type { HabitProgressionService } from '../habit-engine/planner';
import { isoAddDays, rawDayNumberForDate } from '../habit-engine/dates';
import { formatDayLabel, formatPlanProgress, formatScheduledTasks } from './plan-format';
import { computeHabitScore, computeOverallStreak, getCumulativeHabits, getLevelStatus } from '../../lib/engine';

const XP_PER_TASK = 10;
const XP_PER_LEVEL = 250;

/** Compact journey-level stats used in the AI context (mirrors the Progress tab). */
export function buildJourneyOverview(state: AppState, today: string): string {
  if (!state.startDateISO) return 'mission not started';
  // Iterate in pure UTC so day keys match the planner's UTC taskLogs keys
  // (local-time iteration shifts every key by a day on non-UTC machines).
  let totalDone = 0;
  let activeDays = 0;
  let days = 0;
  let cursor = state.startDateISO;
  while (cursor <= today) {
    const done = Object.values(state.taskLogs[cursor] ?? {}).filter(Boolean).length;
    if (done > 0) activeDays += 1;
    totalDone += done;
    days += 1;
    cursor = isoAddDays(cursor, 1);
  }
  const xp = totalDone * XP_PER_TASK;
  const consistency = days > 0 ? Math.round((activeDays / days) * 100) : 0;
  const dayNumber = rawDayNumberForDate(today, state.startDateISO);
  const cleared = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'cleared').length;
  const recovery = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'needs-recovery').length;
  const habits = getCumulativeHabits(dayNumber)
    .map((h) => ({ name: h.name, score: computeHabitScore(h.id, state, today) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const tierOf = (score: number | null): string => (score === null ? 'building' : score >= 70 ? 'strong' : score >= 40 ? 'building' : 'weak');
  const tiers: Record<string, string[]> = { strong: [], building: [], weak: [] };
  for (const h of habits) tiers[tierOf(h.score)].push(`${h.name}(${h.score ?? 'n/a'}%)`);
  const best = habits.find((h) => (h.score ?? -1) >= 0);
  const worst = [...habits].reverse().find((h) => h.score !== null);
  const overallStreak = computeOverallStreak(state, today);
  const achieved: string[] = [];
  if (dayNumber >= 7) achieved.push('Week 1 done');
  if (overallStreak >= 7) achieved.push('7-day streak');
  if (cleared >= 1) achieved.push('first level cleared');
  if (consistency >= 70) achieved.push('70%+ consistency');
  if (xp >= 500) achieved.push('500 XP');
  const bits = [
    `Total XP ${xp} (level ${Math.floor(xp / XP_PER_LEVEL) + 1}, ${xp % XP_PER_LEVEL}/${XP_PER_LEVEL} into level)`,
    `consistency ${consistency}% over ${days} days (${activeDays} active)`,
    `overall streak ${overallStreak}`,
    `levels cleared ${cleared}, need recovery ${recovery}`,
  ];
  if (best) bits.push(`best habit ${best.name} (${best.score}%)`);
  if (worst) bits.push(`weakest habit ${worst.name} (${worst.score}%)`);
  if (achieved.length > 0) bits.push(`achievements: ${achieved.join(', ')}`);
  const latest = [...state.summaries].sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
  if (latest) bits.push(`latest day snapshot ${latest.dateISO}: productivity ${latest.productivityScore}%, thinking ${latest.thinkingScore}%${latest.aiObservations[0] ? ` — ${latest.aiObservations[0]}` : ''}`);
  return bits.join('; ');
}

/** Compact per-day progress rows for the last ~14 days. */
export function buildRecentProgress(state: AppState, today: string, planner: HabitProgressionService): string[] {
  if (!state.startDateISO) return [];
  const todayDay = rawDayNumberForDate(today, state.startDateISO);
  const fromDay = Math.max(1, todayDay - 13);
  const rows: string[] = [];
  for (let day = fromDay; day <= todayDay; day++) {
    const dateISO = isoAddDays(state.startDateISO, day - 1);
    const plan = planner.buildPlan(state, dateISO, DEFAULT_PROGRESSION_CONFIG);
    rows.push(`${formatDayLabel(dateISO)} Day ${day}: ${formatPlanProgress(plan, state)}`);
  }
  return rows;
}

/**
 * Deterministic current-journey context — the full snapshot the AI reference
 * context is built from, returned by the getContext tool so the model can pull
 * a fresh, complete picture on demand (progress/status/overview queries).
 */
export function buildContextOverview(
  state: AppState,
  dateISO: string,
  planner: HabitProgressionService,
  config = DEFAULT_PROGRESSION_CONFIG,
): string {
  if (!state.startDateISO) return 'Journey abhi shuru nahi hui — koi plan ya context nahi hai.';
  const plan = planner.buildPlan(state, dateISO, config);
  const context = planner.buildContext(state, dateISO, config);
  const overview = buildJourneyOverview(state, dateISO);
  const recent = buildRecentProgress(state, dateISO, planner);
  return [
    `Current date: ${formatDayLabel(dateISO)} (${dateISO}). Journey Day ${context.dayNumber} of ${TOTAL_DAYS}, phase ${context.phase}, streak ${context.streak}${context.restDay ? ' [REST DAY — chhuti]' : ''}.`,
    `Today's progress: ${formatPlanProgress(plan, state)}. Study time available: ${context.availableMinutes}min.`,
    `Today's scheduled tasks:`,
    ...formatScheduledTasks(plan, state),
    `Journey so far: ${overview}`,
    `Recent progress: ${recent.join(' | ') || 'none yet'}.`,
    `Weak habits: ${context.weakHabitIds.join(', ') || 'none'}. Strong habits: ${context.strongHabitIds.join(', ') || 'none'}.`,
    `Gaps: ${context.gapDays}. Backlog: ${context.backlogDays}. Recovery mode: ${context.recoveryMode}. Exam window: ${context.examWindowActive}. Test day (mock): ${context.mockSunday}.`,
  ].join('\n');
}
