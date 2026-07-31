// Daily summary produced by the end-of-day pipeline. Stored permanently and
// used as the primary input for tomorrow's planning.

export interface DailySummary {
  id: string;
  dateISO: string;
  completedTaskIds: string[];
  missedTaskIds: string[];
  /** habitId -> completion % for that day. */
  habitProgress: Record<string, number>;
  streak: number;
  weakHabitIds: string[];
  strongHabitIds: string[];
  revisionCompletedIds: string[];
  backlogStatus: { count: number; cleared: number };
  journalInsights: string[];
  aiObservations: string[];
  /** 0..100 — how much structured thinking happened (skill-weighted). */
  thinkingScore: number;
  /** 0..100 — how much of the plan got done (duration-weighted). */
  productivityScore: number;
  /** Suggestions injected into tomorrow's planning. */
  planForTomorrow: string[];
  /** Number of consecutive missed days detected. */
  gapsDetected: number;
  /** True when the summary was produced without an AI provider. */
  aiFallback: boolean;
  createdAt: string;
}

export type SummaryScore = 'thinkingScore' | 'productivityScore';
