import { z } from 'zod';
import { cleanImportText } from '../../core/domain/import-utils';
import type { AppState } from '../../core/domain/state';
import type { ProviderConfig } from '../../core/domain/llm';
import { defaultChatPrefs, MAX_MESSAGES_PER_SESSION, MAX_SESSIONS, type ChatMessage, type ChatPreferences, type ChatSession, type ChatStoreState } from '../../core/domain/chat';
import type { StateStore } from '../../core/ports/repositories';
import { normalizeState } from '../../infra/storage/state-repository';
import { mergeAppState } from '../sync/sync-merge';

/**
 * Backup files use a small, versioned envelope so imports can be validated before
 * any application state is changed. The envelope contains the app identifier,
 * backup kind/version, scope, export timestamp, and the serialized data payload.
 *
 * Scopes:
 * - full: exports the complete normalized app state plus chat sessions.
 * - tasks: exports task/planner-related state without unrelated level progress.
 * - levels: exports cleared levels, reviews, assessments, and post-journey state.
 *
 * Full backups deliberately redact provider/web-search/live secrets. Imports keep
 * the current device's working secrets when the backup contains a redacted value,
 * so moving a backup between devices cannot accidentally erase local credentials.
 *
 * Imports are validated and size-limited before writes. State and chat are prepared
 * and normalized before the store is updated, keeping the import operation atomic
 * from the service's point of view: invalid input never partially replaces state.
 */
export const BACKUP_APP = 'levelup';
export const BACKUP_KIND = 'levelup-backup';
export const BACKUP_VERSION = 1;

export type BackupScope = 'full' | 'tasks' | 'levels';
export const BACKUP_SCOPES: readonly BackupScope[] = ['full', 'tasks', 'levels'] as const;
export const IMPORT_BUDGET_BYTES = 4_000_000;
const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'max'] as const;

export interface BackupPayload {
  app: string;
  kind: typeof BACKUP_KIND;
  version: number;
  scope: BackupScope;
  exportedAt: string;
  data: { state: unknown; chat?: unknown };
}

export interface BackupSummary {
  scope: BackupScope;
  state: {
    journeyStarted: boolean;
    totalDone: number;
    dynamicTasks: number;
    dynamicPhases: string[];
    planDays: number;
    memoryEntries: number;
    clearedLevels: number;
    weeklyReviews: number;
    monthlyAssessments: number;
  };
  chat: { sessions: number; messages: number };
  bytes: number;
}

/** Error raised when a backup cannot be parsed, validated, or safely imported. */
export class BackupError extends Error {
  readonly code: 'INVALID_JSON' | 'INVALID_ENVELOPE' | 'TOO_LARGE' | 'INVALID_STATE' | 'INVALID_CHAT';
  constructor(message: string, code: 'INVALID_JSON' | 'INVALID_ENVELOPE' | 'TOO_LARGE' | 'INVALID_STATE' | 'INVALID_CHAT') {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

const envelopeSchema = z.object({
  app: z.literal(BACKUP_APP),
  kind: z.literal(BACKUP_KIND),
  version: z.literal(BACKUP_VERSION),
  scope: z.enum(['full', 'tasks', 'levels']).default('full'),
  exportedAt: z.string(),
  data: z.object({ state: z.unknown().optional(), chat: z.unknown().optional() }),
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampNumber(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function normalizeChatPrefs(raw: unknown): ChatPreferences {
  const defaults = defaultChatPrefs();
  if (!isRecord(raw)) return defaults;
  return {
    providerId: typeof raw.providerId === 'string' ? raw.providerId : null,
    model: typeof raw.model === 'string' ? raw.model : null,
    temperature: clampNumber(raw.temperature, defaults.temperature, 0, 2),
    maxTokens: Math.floor(clampNumber(raw.maxTokens, defaults.maxTokens, 1, 100_000)),
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : defaults.systemPrompt,
    userPersona: typeof raw.userPersona === 'string' ? raw.userPersona : defaults.userPersona,
    includeContext: typeof raw.includeContext === 'boolean' ? raw.includeContext : defaults.includeContext,
    ...(typeof raw.thinking === 'string' && (THINKING_LEVELS as readonly string[]).includes(raw.thinking) ? { thinking: raw.thinking as ChatPreferences['thinking'] } : {}),
  };
}

/** Normalize imported chat sessions and enforce the application's session/message limits. */
export function normalizeChatSessions(raw: unknown): ChatSession[] {
  if (!isRecord(raw) || !Array.isArray(raw.sessions)) return [];
  const sessions: ChatSession[] = [];
  for (const s of raw.sessions) {
    if (sessions.length >= MAX_SESSIONS) break;
    if (!isRecord(s)) continue;
    if (typeof s.id !== 'string' || !Array.isArray(s.messages)) continue;
    const messages = s.messages.map(normalizeChatMessage).filter((m): m is ChatMessage => m !== null).slice(0, MAX_MESSAGES_PER_SESSION);
    sessions.push({
      id: s.id,
      title: typeof s.title === 'string' ? s.title.slice(0, 200) : '',
      messages,
      prefs: normalizeChatPrefs(s.prefs),
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date(0).toISOString(),
      updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date(0).toISOString(),
      ...(typeof s.memorySummarizedAt === 'string' ? { memorySummarizedAt: s.memorySummarizedAt } : {}),
      ...(typeof s.aiSummarizedAt === 'string' ? { aiSummarizedAt: s.aiSummarizedAt } : {}),
    });
  }
  return sessions;
}

function normalizeChatMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.content !== 'string') return null;
  const role = typeof raw.role === 'string' ? raw.role : '';
  if (role !== 'user' && role !== 'assistant') return null;
  const message: ChatMessage = { id: raw.id, role, content: raw.content, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString() };
  if (typeof raw.model === 'string') message.model = raw.model;
  if (typeof raw.reasoning === 'string') message.reasoning = raw.reasoning;
  if (typeof raw.tool === 'string') message.tool = raw.tool;
  if (typeof raw.stopped === 'boolean') message.stopped = raw.stopped;
  if (Array.isArray(raw.attachments)) message.attachments = raw.attachments as ChatMessage['attachments'];
  return message;
}

/** Build a versioned backup envelope for the requested export scope. */
export function buildBackupPayload(state: AppState, chat: ChatStoreState | null, scope: BackupScope = 'full'): BackupPayload {
  const data: BackupPayload['data'] = { state: {} };
  if (scope === 'full') {
    const full = normalizeState(state);
    const providers: Record<string, ProviderConfig> = {};
    for (const [id, p] of Object.entries(full.aiSettings.providers ?? {})) {
      providers[id] = { ...p, apiKey: undefined, customHeaders: undefined };
    }
    const websearch = full.aiSettings.websearch ? { ...full.aiSettings.websearch, apiKey: '' } : full.aiSettings.websearch;
    const live = full.aiSettings.live ? { ...full.aiSettings.live, apiKey: full.aiSettings.live.apiKey ? 'REDACTED_IN_BACKUP' : undefined } : undefined;
    data.state = { ...full, aiSettings: { ...full.aiSettings, modelCache: {}, providers, websearch, live } };
    if (chat) data.chat = { version: 1, sessions: chat.sessions };
  } else if (scope === 'tasks') {
    const full = normalizeState(state);
    data.state = {
      dynamicTaskBank: full.dynamicTaskBank,
      customTodos: full.customTodos,
      studyVault: full.studyVault,
      customHabits: full.customHabits,
      taskLogs: full.taskLogs,
      planCache: full.planCache,
      restDays: full.restDays,
      testDays: full.testDays,
      masteryPlacement: full.masteryPlacement,
    };
  } else if (scope === 'levels') {
    const full = normalizeState(state);
    data.state = {
      clearedLevels: full.clearedLevels,
      weeklyReviews: full.weeklyReviews,
      monthlyAssessments: full.monthlyAssessments,
      postJourney: full.postJourney,
    };
  }
  return { app: BACKUP_APP, kind: BACKUP_KIND, version: BACKUP_VERSION, scope, exportedAt: new Date().toISOString(), data };
}

/** Serialize a validated backup payload into its portable JSON representation. */
export function serializeBackup(payload: BackupPayload): string { return JSON.stringify(payload, null, 2); }

/** Parse and validate a backup envelope before it can reach the import path. */
export function parseBackup(json: string): BackupPayload {
  let parsed: unknown;
  try { parsed = JSON.parse(cleanImportText(json)); }
  catch { throw new BackupError('File valid JSON nahi hai. Sahi backup file select karo.', 'INVALID_JSON'); }
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) throw new BackupError('Ye file LevelUp backup nahi lagti (galat format ya unsupported version).', 'INVALID_ENVELOPE');
  return result.data as BackupPayload;
}

export interface ApplyBackupOptions { maxBytes?: number; }
export interface ApplyBackupTargets { store: StateStore; chat?: { replaceStore(sessions: ChatSession[]): void } }

/** Validate and atomically apply a backup to the supplied state/chat targets. */
export function applyBackup(payload: BackupPayload, targets: ApplyBackupTargets, opts: ApplyBackupOptions = {}): BackupSummary {
  const bytes = serializeBackup(payload).length;
  const maxBytes = opts.maxBytes ?? IMPORT_BUDGET_BYTES;
  if (bytes > maxBytes) throw new BackupError(`Backup file bahut bada hai (${Math.round(bytes / 1_000_000)}MB). Is device ke storage budget ke andar nahi aayega.`, 'TOO_LARGE');
  const scope = payload.scope ?? 'full';
  const rawState = isRecord(payload.data.state) ? payload.data.state : {};

  if (scope === 'full') {
    const state = normalizeState(rawState);
    if (!isRecord(state)) throw new BackupError('Backup ka state section valid nahi hai.', 'INVALID_STATE');
    const sessions = normalizeChatSessions(payload.data.chat);
    const withRedaction = (redact: (s: AppState) => AppState): AppState => {
      const current = targets.store.get();
      const merged: AppState = { ...state, aiSettings: { ...state.aiSettings } };
      const liveBackup = state.aiSettings.live;
      const liveCurrent = current.aiSettings?.live;
      const redactedLive = liveBackup && (liveBackup.apiKey === 'REDACTED_IN_BACKUP' || liveBackup.apiKey === 'REDACTED_IN_SYNC');
      merged.aiSettings.live = redactedLive && liveCurrent ? { ...liveBackup, apiKey: liveCurrent.apiKey } : liveBackup;
      const safeWeb = state.aiSettings.websearch;
      if (safeWeb && !safeWeb.apiKey && current.aiSettings?.websearch?.apiKey) merged.aiSettings.websearch = { ...safeWeb, apiKey: current.aiSettings.websearch.apiKey };
      for (const [id, p] of Object.entries(state.aiSettings.providers ?? {})) {
        if (!p || p.apiKey !== undefined) continue;
        const cur = current.aiSettings?.providers?.[id];
        if (cur?.apiKey) merged.aiSettings.providers = { ...(merged.aiSettings.providers ?? {}), [id]: { ...p, apiKey: cur.apiKey, customHeaders: cur.customHeaders } };
      }
      return redact(merged);
    };
    const restored = withRedaction((s) => s);
    targets.store.save(restored);
    targets.chat?.replaceStore(sessions);
    return summarizeBackup(restored, sessions, bytes, scope);
  }

  const current = targets.store.get();
  if (scope === 'tasks') {
    const incoming = normalizeState(rawState);
    const merged = mergeAppState(current, incoming);
    // mergeAppState intentionally preserves local generated plans/placements when
    // both devices have values for the same key. Union the task-specific maps here
    // so a scoped backup cannot erase dates/placements that exist only on the backup.
    const taskMerged: AppState = {
      ...merged,
      planCache: { ...incoming.planCache, ...current.planCache },
      masteryPlacement: { ...incoming.masteryPlacement, ...current.masteryPlacement },
    };
    targets.store.save(taskMerged);
    return summarizeBackup(taskMerged, [], bytes, scope);
  }
  const incoming = normalizeState(rawState);
  const merged: AppState = { ...current, clearedLevels: incoming.clearedLevels, weeklyReviews: incoming.weeklyReviews, monthlyAssessments: incoming.monthlyAssessments, postJourney: incoming.postJourney };
  targets.store.save(merged);
  return summarizeBackup(merged, [], bytes, scope);
}

/** Summarize the state and chat contents represented by a backup operation. */
export function summarizeBackup(state: AppState, sessions: ChatSession[], bytes: number, scope: BackupScope = 'full'): BackupSummary {
  const dynamicTasks = Array.isArray(state.dynamicTaskBank) ? state.dynamicTaskBank.length : 0;
  const dynamicPhases = Array.isArray(state.dynamicTaskBank) ? [...new Set(state.dynamicTaskBank.map((task) => task.phase).filter(Boolean))] : [];
  const planDays = state.planCache && typeof state.planCache === 'object' ? Object.keys(state.planCache).length : 0;
  const memoryEntries = Array.isArray(state.memory?.entries) ? state.memory.entries.length : 0;
  const clearedLevels = Array.isArray(state.clearedLevels) ? state.clearedLevels.length : 0;
  const weeklyReviews = Array.isArray(state.weeklyReviews) ? state.weeklyReviews.length : 0;
  const monthlyAssessments = Array.isArray(state.monthlyAssessments) ? state.monthlyAssessments.length : 0;
  const totalDone = state.taskLogs && typeof state.taskLogs === 'object'
    ? Object.values(state.taskLogs).reduce((total, day) => total + (day && typeof day === 'object' ? Object.values(day).filter(Boolean).length : 0), 0)
    : 0;
  return {
    scope,
    state: { journeyStarted: Boolean(state.startDateISO), totalDone, dynamicTasks, dynamicPhases, planDays, memoryEntries, clearedLevels, weeklyReviews, monthlyAssessments },
    chat: { sessions: sessions.length, messages: sessions.reduce((total, s) => total + s.messages.length, 0) },
    bytes,
  };
}

/** Format a byte count for human-readable backup UI. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
