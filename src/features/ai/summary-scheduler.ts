import type { AppState } from '../../core/domain/state';

/**
 * Day-snapshot scheduling for the daily summary pipeline (M8 fix).
 *
 * The pipeline itself used to be dead code — nothing in production ever called
 * runDailyPipeline, so `state.summaries` stayed empty and the journey context
 * (context-overview.ts, habit-engine/context.ts) always saw zero day
 * snapshots. These pure helpers wire the pipeline to the day-change hook in a
 * testable, side-effect-free way (see useAppState).
 */

/** True when a new calendar day has started since the last rollup AND the
 *  journey has begun. Idempotent per date: lastSummaryDate === today → false. */
export function shouldRollupDay(state: AppState, today: string): boolean {
  return Boolean(state.startDateISO) && state.lastSummaryDate !== today;
}

function mergeMemoryById(latest: AppState['memory'], next: AppState['memory']): AppState['memory'] {
  // `next` is derived from a snapshot taken before the slow daily pipeline ran.
  // Keep the live/latest version of existing entries, while importing only
  // entries the pipeline added during its run. This prevents chat/addMemory
  // writes made concurrently with the pipeline from being overwritten.
  const mergeEntries = (current: typeof latest.entries, pipeline: typeof next.entries) => {
    const currentIds = new Set(current.map((entry) => entry.id));
    return [...current, ...pipeline.filter((entry) => !currentIds.has(entry.id))];
  };
  const lastSummarizedAt = (() => {
    if (!latest.lastSummarizedAt) return next.lastSummarizedAt;
    if (!next.lastSummarizedAt) return latest.lastSummarizedAt;
    const latestTime = Date.parse(latest.lastSummarizedAt);
    const nextTime = Date.parse(next.lastSummarizedAt);
    if (!Number.isFinite(latestTime)) return next.lastSummarizedAt;
    if (!Number.isFinite(nextTime)) return latest.lastSummarizedAt;
    return nextTime >= latestTime ? next.lastSummarizedAt : latest.lastSummarizedAt;
  })();

  return {
    ...latest,
    entries: mergeEntries(latest.entries, next.entries),
    summaries: mergeEntries(latest.summaries, next.summaries),
    lastSummarizedAt,
  };
}

/** Merges a freshly built day snapshot onto the LATEST state so concurrent UI
 *  edits made while the (slow, AI-enriched) pipeline ran are never lost. Only
 *  the summary fields + memory additions are taken from `next`; everything
 *  else comes from `latest`. */
export function mergeDaySummary(latest: AppState, next: AppState, dateISO: string): AppState {
  return {
    ...latest,
    summaries: [
      ...latest.summaries.filter((s) => s.dateISO !== dateISO),
      ...next.summaries.filter((s) => s.dateISO === dateISO),
    ],
    lastSummaryDate: dateISO,
    memory: mergeMemoryById(latest.memory, next.memory),
  };
}
