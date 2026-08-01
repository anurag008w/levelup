import type { KeyValueRepository, StateRepository, StateStore } from '../../core/ports/repositories';
import type { AppState } from '../../core/domain/state';
import { emptyAppState, STATE_SCHEMA_VERSION } from '../../core/domain/state';
import { migrateV1toV2 } from './migration';

export const STATE_KEY_V1 = 'human-os-state-v1';
export const STATE_KEY = 'human-os-state-v2';

const REQUIRED_V2_KEYS = [
  'schemaVersion',
  'startDateISO',
  'bonusDaysUsed',
  'taskLogs',
  'weeklyReviews',
  'monthlyAssessments',
  'failureLog',
  'examDateISO',
  'clearedLevels',
  'memory',
  'summaries',
  'aiSettings',
  'dynamicTaskBank',
  'planCache',
  'studyTimeMinutes',
  'lastSummaryDate',
  'aiActionHistory',
] as const;

/** Defensively rebuilds a v2 state from whatever came out of storage. */
export function normalizeState(raw: unknown): AppState {
  const base = emptyAppState();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    startDateISO: typeof r.startDateISO === 'string' ? r.startDateISO : base.startDateISO,
    bonusDaysUsed: typeof r.bonusDaysUsed === 'number' ? r.bonusDaysUsed : 0,
    taskLogs: isRecord(r.taskLogs) ? (r.taskLogs as AppState['taskLogs']) : {},
    weeklyReviews: Array.isArray(r.weeklyReviews) ? r.weeklyReviews : [],
    monthlyAssessments: Array.isArray(r.monthlyAssessments) ? r.monthlyAssessments : [],
    failureLog: Array.isArray(r.failureLog) ? r.failureLog : [],
    examDateISO: typeof r.examDateISO === 'string' ? r.examDateISO : null,
    clearedLevels: Array.isArray(r.clearedLevels) ? r.clearedLevels : [],
    memory:
      isRecord(r.memory) && Array.isArray((r.memory as { entries?: unknown }).entries)
        ? (r.memory as unknown as AppState['memory'])
        : base.memory,
    summaries: Array.isArray(r.summaries) ? r.summaries : [],
    aiSettings:
      isRecord(r.aiSettings) && isRecord((r.aiSettings as { providers?: unknown }).providers)
        ? (r.aiSettings as unknown as AppState['aiSettings'])
        : base.aiSettings,
    dynamicTaskBank: Array.isArray(r.dynamicTaskBank) ? r.dynamicTaskBank : [],
    planCache: isRecord(r.planCache) ? (r.planCache as AppState['planCache']) : {},
    studyTimeMinutes: typeof r.studyTimeMinutes === 'number' && r.studyTimeMinutes > 0 ? r.studyTimeMinutes : 360,
    aiActionHistory:
      isRecord(r.aiActionHistory) && Array.isArray((r.aiActionHistory as { versions?: unknown }).versions)
        ? {
            versions: (r.aiActionHistory as { versions: AppState['aiActionHistory']['versions']; undone?: unknown }).versions,
            undone: Array.isArray((r.aiActionHistory as { undone?: unknown }).undone)
              ? ((r.aiActionHistory as { undone: AppState['aiActionHistory']['undone'] }).undone)
              : [],
          }
        : base.aiActionHistory,
    lastSummaryDate: typeof r.lastSummaryDate === 'string' ? r.lastSummaryDate : null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class LocalStateRepository {
  private readonly store: KeyValueRepository;

  constructor(store: KeyValueRepository) {
    this.store = store;
  }

  load(): AppState {
    const rawV2 = this.store.getItem(STATE_KEY);
    if (rawV2 !== null) {
      try {
        return normalizeState(JSON.parse(rawV2));
      } catch {
        // Corrupt v2 — fall through to migration path.
      }
    }
    const rawV1 = this.store.getItem(STATE_KEY_V1);
    if (rawV1 !== null) {
      try {
        const migrated = migrateV1toV2(JSON.parse(rawV1));
        this.save(migrated);
        return migrated;
      } catch {
        // Corrupt v1 — return a fresh state (old key is left untouched).
      }
    }
    return emptyAppState();
  }

  save(state: AppState): void {
    this.store.setItem(STATE_KEY, JSON.stringify(normalizeState(state)));
  }

  clear(): void {
    this.store.setItem(STATE_KEY, JSON.stringify(emptyAppState()));
  }
}

export function hasV2Shape(raw: unknown): boolean {
  return isRecord(raw) && REQUIRED_V2_KEYS.every((k) => k in raw);
}

/** In-memory StateStore backed by a StateRepository (single source of truth). */
export class CachedStateStore implements StateStore {
  private cache: AppState | null = null;
  private readonly repo: StateRepository;

  constructor(repo: StateRepository) {
    this.repo = repo;
  }

  get(): AppState {
    if (!this.cache) this.cache = this.repo.load();
    return this.cache;
  }

  save(state: AppState): void {
    this.cache = state;
    this.repo.save(state);
  }
}
