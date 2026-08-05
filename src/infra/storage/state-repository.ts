import type { KeyValueRepository, StateRepository, StateStore } from '../../core/ports/repositories';
import type { AppState } from '../../core/domain/state';
import { defaultUserProfile, emptyAppState, STATE_SCHEMA_VERSION } from '../../core/domain/state';
import { MEMORY_BYTES_BUDGET, normalizeMemoryStore, pruneMemoryToBudget } from '../../core/domain/memory';
import { INTERNAL_SYSTEM_PROMPT, LEGACY_MISA_SYSTEM_PROMPT } from '../../core/domain/chat';
import { normalizePlanners } from '../../core/domain/subject-planner';
import { migrateV1toV2 } from './migration';

export const STATE_KEY_V1 = 'levelup-state-v1';
export const STATE_KEY = 'levelup-state-v2';

/** Serialized state budget — kept safely under the ~5MB localStorage quota. */
const STATE_SAVE_BUDGET = 3_500_000;

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
    memory: normalizeMemoryStore(r.memory),
    summaries: Array.isArray(r.summaries) ? r.summaries : [],
    aiSettings:
      isRecord(r.aiSettings) && isRecord((r.aiSettings as { providers?: unknown }).providers)
        ? {
            ...base.aiSettings,
            ...(r.aiSettings as Partial<AppState['aiSettings']>),
            chat: isRecord((r.aiSettings as { chat?: unknown }).chat)
              ? (() => {
                  const storedChat = (r.aiSettings as { chat: unknown }).chat as Partial<AppState['aiSettings']['chat']>;
                  // Sessions/global settings still carrying the old longer Misa
                  // default are upgraded to the compressed persona on load;
                  // user-edited text is never touched (exact match only).
                  const systemPrompt =
                    storedChat.systemPrompt === LEGACY_MISA_SYSTEM_PROMPT ? INTERNAL_SYSTEM_PROMPT : storedChat.systemPrompt;
                  return { ...base.aiSettings.chat, ...storedChat, systemPrompt: systemPrompt ?? base.aiSettings.chat.systemPrompt };
                })()
              : base.aiSettings.chat,
          }
        : base.aiSettings,
    dynamicTaskBank: Array.isArray(r.dynamicTaskBank) ? r.dynamicTaskBank : [],
    restDays: Array.isArray(r.restDays) ? r.restDays : [],
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
    // Post-journey (v3) - handles migration from older versions
    postJourney:
      isRecord(r.postJourney)
        ? {
            ...base.postJourney,
            ...(r.postJourney as Partial<AppState['postJourney']>),
          }
        : base.postJourney,
    userProfile: isRecord(r.userProfile)
      ? {
          ...defaultUserProfile(),
          ...(r.userProfile as Partial<AppState['userProfile']>),
        }
      : base.userProfile,
    timeZone: typeof r.timeZone === 'string' && r.timeZone.length > 0 ? r.timeZone : null,
    customHabits: Array.isArray(r.customHabits) ? r.customHabits : [],
    curriculumEditing: typeof r.curriculumEditing === 'boolean' ? r.curriculumEditing : false,
    subjectPlanners: normalizePlanners(r.subjectPlanners),
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
    let normalized = normalizeState(state);
    let serialized = JSON.stringify(normalized);
    // Quota safeguard: if the whole state is about to exceed the localStorage
    // budget, shrink memory (the biggest consumer) until it fits, then write
    // that. Better a trimmed memory than a silently lost save on restart.
    if (serialized.length > STATE_SAVE_BUDGET) {
      normalized = { ...normalized, memory: pruneMemoryToBudget(normalized.memory, MEMORY_BYTES_BUDGET) };
      serialized = JSON.stringify(normalized);
    }
    this.store.setItem(STATE_KEY, serialized);
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
