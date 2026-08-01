import type { AppState } from '../../core/domain/state';
import { emptyAppState, STATE_SCHEMA_VERSION } from '../../core/domain/state';

/** Legacy v1 state shape (as originally persisted under levelup-state-v1). */
interface AppStateV1 {
  startDateISO: string | null;
  bonusDaysUsed: number;
  taskLogs: Record<string, Record<string, boolean>>;
  weeklyReviews: Array<{
    weekNumber: number;
    dateISO: string;
    strongest: string;
    weakest: string;
    planForNextWeek: string;
  }>;
  monthlyAssessments: Array<{ monthNumber: number; dateISO: string; reflection: string }>;
  failureLog: Array<{ dateISO: string; completionPct: number; note: string }>;
  examDateISO: string | null;
  clearedLevels: number[];
}

/**
 * Migrates persisted v1 state to v2. The v1 key is never modified/deleted, so
 * a downgrade or manual restore is always possible. All v1 progress (task
 * logs, reviews, exam date, level clears) is carried over unchanged.
 */
export function migrateV1toV2(raw: unknown): AppState {
  const v1 = (typeof raw === 'object' && raw !== null ? raw : {}) as AppStateV1;
  const fresh = emptyAppState();
  return {
    ...fresh,
    schemaVersion: STATE_SCHEMA_VERSION,
    startDateISO: v1.startDateISO ?? fresh.startDateISO,
    bonusDaysUsed: typeof v1.bonusDaysUsed === 'number' ? v1.bonusDaysUsed : 0,
    taskLogs: v1.taskLogs ?? {},
    weeklyReviews: v1.weeklyReviews ?? [],
    monthlyAssessments: v1.monthlyAssessments ?? [],
    failureLog: v1.failureLog ?? [],
    examDateISO: v1.examDateISO ?? null,
    clearedLevels: v1.clearedLevels ?? [],
  };
}
