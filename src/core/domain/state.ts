import type { MemoryStore } from './memory';
import type { DailySummary } from './summary';
import type { DailyPlan } from './progress';
import type { ProviderConfig, ModelInfo } from './llm';
import type { TaskBankEntry } from './task-bank';
import type { AiActionHistoryState } from './ai-actions';
import { emptyAiActionHistory } from './ai-actions';

// Persisted application state (localStorage). Schema v2.

export const STATE_SCHEMA_VERSION = 2;

export interface AiSettings {
  providers: Record<string, ProviderConfig>;
  activeProviderId: string | null;
  /** Locally cached model catalogs per provider: id -> models. */
  modelCache: Record<string, ModelInfo[]>;
  /** Whether the AI layer participates in planning (master switch). */
  aiEnabled: boolean;
}

export interface AppState {
  schemaVersion: number;

  // --- legacy v1 fields (kept for backward compatibility) ---
  startDateISO: string | null;
  bonusDaysUsed: number;
  taskLogs: Record<string, import('./progress').DayLog>;
  weeklyReviews: import('./progress').WeeklyReviewEntry[];
  monthlyAssessments: import('./progress').MonthlyAssessmentEntry[];
  failureLog: import('./progress').FailureLogEntry[];
  examDateISO: string | null;
  clearedLevels: number[];

  // --- v2 fields ---
  memory: MemoryStore;
  summaries: DailySummary[];
  aiSettings: AiSettings;
  /** AI-generated / user-created tasks persisted into the dynamic bank. */
  dynamicTaskBank: TaskBankEntry[];
  /** Journey day numbers marked as rest/holiday (no auto-plan; only explicit tasks). */
  restDays: number[];
  /** One generated plan per dateISO. */
  planCache: Record<string, DailyPlan>;
  /** Daily available study time in minutes. */
  studyTimeMinutes: number;
  /** Versioned, undoable audit trail for AI-generated application changes. */
  aiActionHistory: AiActionHistoryState;
  lastSummaryDate: string | null;
}

export function defaultAiSettings(): AiSettings {
  return { providers: {}, activeProviderId: null, modelCache: {}, aiEnabled: true };
}

export function emptyAppState(): AppState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    startDateISO: null,
    bonusDaysUsed: 0,
    taskLogs: {},
    weeklyReviews: [],
    monthlyAssessments: [],
    failureLog: [],
    examDateISO: null,
    clearedLevels: [],
    memory: { entries: [], summaries: [], lastSummarizedAt: null },
    summaries: [],
    aiSettings: defaultAiSettings(),
    dynamicTaskBank: [],
    restDays: [],
    planCache: {},
    studyTimeMinutes: 360,
    aiActionHistory: emptyAiActionHistory(),
    lastSummaryDate: null,
  };
}
