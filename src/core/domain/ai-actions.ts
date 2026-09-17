import { NINETY_DAY_ONLY_ACTION_SET } from './chat-tools';
import type { AppState } from './state';

export type AiActionPermission = 'read' | 'create' | 'edit' | 'delete' | 'bulk-edit' | 'admin';
export type AiActionStatus = 'preview' | 'applied' | 'undone' | 'redone' | 'failed';

export interface AiActionVersion {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  permissions: AiActionPermission[];
  beforeState: unknown;
  afterState: unknown;
  changedFields: string[];
  confirmationRequired: boolean;
  confirmed: boolean;
  status: AiActionStatus;
  error?: string;
}

export interface AiActionHistoryState {
  versions: AiActionVersion[];
  undone: AiActionVersion[];
}

export interface AiActionContext {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  permissions: AiActionPermission[];
  confirmationRequired?: boolean;
  confirmed?: boolean;
}

export interface AiActionPreview {
  ok: boolean;
  requiresConfirmation: true;
  summary: string;
  action: string;
  entityType: string;
  entityId: string;
  changedFields: string[];
  beforeState: unknown;
  afterState: unknown;
}

export const AI_ACTION_HISTORY_RETENTION_DAYS = 90;

export interface AiPermissionPolicy {
  allowed: AiActionPermission[];
}

export interface AiPermissionDecision {
  allowed: boolean;
  missing: AiActionPermission[];
  message?: string;
}

export interface AiRegisteredAction {
  id: string;
  label: string;
  description: string;
  entityType: string;
  permissions: AiActionPermission[];
  confirmationRequired?: boolean;
  supportsBulk?: boolean;
}

export class AiActionRegistry {
  private readonly actions = new Map<string, AiRegisteredAction>();

  register(action: AiRegisteredAction): void {
    this.actions.set(action.id, action);
  }

  require(id: string): AiRegisteredAction {
    const action = this.actions.get(id);
    if (!action) throw new Error(`AI action not registered: ${id}`);
    return action;
  }

  list(): AiRegisteredAction[] {
    return [...this.actions.values()];
  }
}

export class AiPermissionEngine {
  private readonly policy: AiPermissionPolicy;

  constructor(policy: AiPermissionPolicy = { allowed: ['read', 'create', 'edit', 'delete', 'bulk-edit'] }) {
    this.policy = policy;
  }

  can(permissions: AiActionPermission[]): AiPermissionDecision {
    const missing = permissions.filter((permission) => !this.policy.allowed.includes(permission));
    return {
      allowed: missing.length === 0,
      missing,
      message: missing.length > 0 ? `Missing AI permission(s): ${missing.join(', ')}` : undefined,
    };
  }
}

export interface AiActionExecutionInput {
  state: AppState;
  action: AiRegisteredAction;
  entityId: string;
  summary: string;
  beforeState: unknown;
  afterState: unknown;
  confirmed?: boolean;
  permissionEngine?: AiPermissionEngine;
  now?: Date;
}

export interface AiActionExecutionResult {
  state: AppState;
  ok: boolean;
  summary: string;
  requiresConfirmation?: boolean;
  versionId?: string;
}

export function executeAiAction(input: AiActionExecutionInput): AiActionExecutionResult {
  // Capability boundary: when the 90-day track is OFF, a 90-day-only action can
  // never reach the permission/execution layer — regardless of which caller
  // (chat decision hop, future route, etc.) produced it. This is the domain-level
  // source of truth that a UI catalog filter alone can never replace: even if a
  // caller bypasses the chat layer, execution is refused right here.
  if (state90DayOnlyBlocked(input.state, input.action.id)) {
    return {
      state: input.state,
      ok: false,
      summary: '90-day track is disabled. 90-day tools are unavailable.',
    };
  }

  const permission = (input.permissionEngine ?? new AiPermissionEngine()).can(input.action.permissions);
  if (!permission.allowed) return { state: input.state, ok: false, summary: permission.message ?? 'AI permission denied' };

  const context: AiActionContext = {
    action: input.action.id,
    entityType: input.action.entityType,
    entityId: input.entityId,
    summary: input.summary,
    permissions: input.action.permissions,
    confirmationRequired: input.action.confirmationRequired ?? requiresConfirmation(input.action.permissions),
    confirmed: input.confirmed ?? false,
  };
  if (context.confirmationRequired && !context.confirmed) {
    const preview = createAiActionPreview(context, input.beforeState, input.afterState);
    return {
      state: input.state,
      ok: false,
      requiresConfirmation: true,
      summary: `${preview.summary}. Changed fields: ${preview.changedFields.join(', ')}. Reply with explicit confirmation to apply.`,
    };
  }

  const entityState = applySnapshot(input.state, input.action.entityType, input.afterState);
  const saved = recordAiActionVersion(entityState, context, input.beforeState, input.afterState, input.now);
  return {
    state: saved,
    ok: true,
    versionId: saved.aiActionHistory.versions.at(-1)?.id,
    summary: `${input.summary}. Version:${saved.aiActionHistory.versions.at(-1)?.id ?? 'n/a'}.`,
  };
}

const DESTRUCTIVE_PERMISSIONS = new Set<AiActionPermission>(['delete', 'bulk-edit', 'admin']);

/**
 * Domain-level capability check: is this action a 90-day-only tool that must be
 * blocked because the 90-day track is currently OFF? Shared by executeAiAction
 * so any route that reaches the execution layer is still refused.
 */
export function state90DayOnlyBlocked(state: Pick<AppState, 'enable90DayTrack'>, actionId: string): boolean {
  if (state.enable90DayTrack !== false) return false;
  return NINETY_DAY_ONLY_ACTION_SET.has(actionId);
}

export function emptyAiActionHistory(): AiActionHistoryState {
  return { versions: [], undone: [] };
}

export function requiresConfirmation(permissions: AiActionPermission[]): boolean {
  return permissions.some((permission) => DESTRUCTIVE_PERMISSIONS.has(permission));
}

export function createAiActionPreview(context: AiActionContext, beforeState: unknown, afterState: unknown): AiActionPreview {
  return {
    ok: false,
    requiresConfirmation: true,
    summary: `Preview only — confirmation required before AI can ${context.summary}`,
    action: context.action,
    entityType: context.entityType,
    entityId: context.entityId,
    changedFields: changedFields(beforeState, afterState),
    beforeState,
    afterState,
  };
}

export function recordAiActionVersion(
  state: AppState,
  context: AiActionContext,
  beforeState: unknown,
  afterState: unknown,
  now: Date = new Date(),
): AppState {
  const timestamp = now.toISOString();
  const version: AiActionVersion = {
    id: uid('aiv'),
    timestamp,
    action: context.action,
    entityType: context.entityType,
    entityId: context.entityId,
    summary: context.summary,
    permissions: context.permissions,
    beforeState,
    afterState,
    changedFields: changedFields(beforeState, afterState),
    confirmationRequired: context.confirmationRequired ?? requiresConfirmation(context.permissions),
    confirmed: context.confirmed ?? false,
    status: 'applied',
  };
  return {
    ...state,
    aiActionHistory: {
      versions: pruneVersions([...state.aiActionHistory.versions, version], now),
      undone: [],
    },
  };
}

export function undoLastAiAction(state: AppState): AppState {
  const latest = [...state.aiActionHistory.versions].reverse().find((version) => version.status === 'applied' || version.status === 'redone');
  if (!latest) return state;
  return restoreVersionBefore(state, latest.id);
}

export function redoLastAiAction(state: AppState): AppState {
  const latest = state.aiActionHistory.undone.at(-1);
  if (!latest) return state;
  const restored = applyVersionAfter(state, latest.id);
  return restored;
}

export function restoreVersionBefore(state: AppState, versionId: string): AppState {
  const version = state.aiActionHistory.versions.find((item) => item.id === versionId);
  if (!version) return state;
  const restored = version.entityType === 'taskLogs'
    ? restoreTaskLogsSnapshot(state, version.beforeState, version.afterState)
    : applySnapshot(state, version.entityType, version.beforeState);
  return {
    ...restored,
    aiActionHistory: {
      versions: state.aiActionHistory.versions.map((item) => (item.id === versionId ? { ...item, status: 'undone' } : item)),
      undone: [...state.aiActionHistory.undone.filter((item) => item.id !== versionId), { ...version, status: 'undone' }],
    },
  };
}

export function applyVersionAfter(state: AppState, versionId: string): AppState {
  const version = state.aiActionHistory.undone.find((item) => item.id === versionId);
  if (!version) return state;
  const restored = version.entityType === 'taskLogs'
    ? restoreTaskLogsSnapshot(state, version.afterState, version.beforeState)
    : applySnapshot(state, version.entityType, version.afterState);
  return {
    ...restored,
    aiActionHistory: {
      versions: state.aiActionHistory.versions.map((item) => (item.id === versionId ? { ...item, status: 'redone' } : item)),
      undone: state.aiActionHistory.undone.filter((item) => item.id !== versionId),
    },
  };
}

/**
 * Task-log snapshots are optimistic undo/redo patches rather than whole-state
 * replacements. If a task value changed after the AI snapshot, it is a newer
 * user/device write and must survive the undo/redo. Only values still equal to
 * the snapshot being replaced are reverted.
 */
function restoreTaskLogsSnapshot(state: AppState, replacement: unknown, expectedCurrent: unknown): AppState {
  if (!isRecord(replacement) || !isRecord(expectedCurrent)) return applySnapshot(state, 'taskLogs', replacement);
  const current = state.taskLogs;
  const replacementLogs = replacement as Record<string, Record<string, boolean>>;
  const expectedLogs = expectedCurrent as Record<string, Record<string, boolean>>;
  const dayKeys = new Set([...Object.keys(current), ...Object.keys(replacementLogs), ...Object.keys(expectedLogs)]);
  const merged: AppState['taskLogs'] = { ...current };

  for (const day of dayKeys) {
    const currentDay = current[day] ?? {};
    const replacementDay = replacementLogs[day] ?? {};
    const expectedDay = expectedLogs[day] ?? {};
    const taskIds = new Set([...Object.keys(currentDay), ...Object.keys(replacementDay), ...Object.keys(expectedDay)]);
    const mergedDay = { ...currentDay };
    let changed = false;

    for (const taskId of taskIds) {
      const currentValue = currentDay[taskId];
      const expectedValue = expectedDay[taskId];
      const replacementValue = replacementDay[taskId];
      if (currentValue !== expectedValue) continue;

      if (replacementValue === undefined) {
        if (currentValue !== undefined) {
          delete mergedDay[taskId];
          changed = true;
        }
      } else if (currentValue !== replacementValue) {
        mergedDay[taskId] = replacementValue;
        changed = true;
      }
    }

    if (changed) merged[day] = mergedDay;
    else if (!(day in current) && Object.keys(mergedDay).length > 0) merged[day] = mergedDay;
  }

  return { ...state, taskLogs: merged };
}

/** Day-mode arrays represent sets; canonicalize them when action snapshots are persisted/restored. */
function normalizeDayNumbers(value: unknown, fallback: AppState['restDays']): AppState['restDays'] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value)].filter((day): day is number => typeof day === 'number' && Number.isInteger(day));
}

function applySnapshot(state: AppState, entityType: string, snapshot: unknown): AppState {
  if (entityType === 'dynamicTaskBank' && Array.isArray(snapshot)) {
    return { ...state, dynamicTaskBank: snapshot as AppState['dynamicTaskBank'] };
  }
  if (entityType === 'taskLogs' && isRecord(snapshot)) {
    return { ...state, taskLogs: snapshot as AppState['taskLogs'] };
  }
  if (entityType === 'restDays' && Array.isArray(snapshot)) {
    return { ...state, restDays: normalizeDayNumbers(snapshot, state.restDays) };
  }
  if (entityType === 'testDays' && Array.isArray(snapshot)) {
    return { ...state, testDays: normalizeDayNumbers(snapshot, state.testDays) as AppState['testDays'] };
  }
  if (entityType === 'dayModes' && isRecord(snapshot)) {
    const dayModes = snapshot as { restDays?: unknown; testDays?: unknown };
    return {
      ...state,
      restDays: normalizeDayNumbers(dayModes.restDays, state.restDays),
      testDays: normalizeDayNumbers(dayModes.testDays, state.testDays) as AppState['testDays'],
    };
  }
  if (entityType === 'aiSettings' && isRecord(snapshot)) {
    return { ...state, aiSettings: snapshot as unknown as AppState['aiSettings'] };
  }
  return state;
}

function changedFields(beforeState: unknown, afterState: unknown): string[] {
  if (!isRecord(beforeState) || !isRecord(afterState)) return ['value'];
  const keys = new Set([...Object.keys(beforeState), ...Object.keys(afterState)]);
  return [...keys].filter((key) => JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key]));
}

function pruneVersions(versions: AiActionVersion[], now: Date): AiActionVersion[] {
  const cutoff = now.getTime() - AI_ACTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return versions.filter((version) => new Date(version.timestamp).getTime() >= cutoff);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
