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

/** Merges a freshly built day snapshot onto the LATEST state so concurrent UI
 *  edits made while the (slow, AI-enriched) pipeline ran are never lost. Only
 *  the summary fields + the pipeline's memory additions are taken from `next`;
 *  everything else comes from `latest`. */
export function mergeDaySummary(latest: AppState, next: AppState, dateISO: string): AppState {
  return {
    ...latest,
    summaries: [
      ...latest.summaries.filter((s) => s.dateISO !== dateISO),
      ...next.summaries.filter((s) => s.dateISO === dateISO),
    ],
    lastSummaryDate: dateISO,
    memory: next.memory,
  };
}
