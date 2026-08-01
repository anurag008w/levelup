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
  const restored = applySnapshot(state, version.entityType, version.beforeState);
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
  const restored = applySnapshot(state, version.entityType, version.afterState);
  return {
    ...restored,
    aiActionHistory: {
      versions: state.aiActionHistory.versions.map((item) => (item.id === versionId ? { ...item, status: 'redone' } : item)),
      undone: state.aiActionHistory.undone.filter((item) => item.id !== versionId),
    },
  };
}

function applySnapshot(state: AppState, entityType: string, snapshot: unknown): AppState {
  if (entityType === 'dynamicTaskBank' && Array.isArray(snapshot)) {
    return { ...state, dynamicTaskBank: snapshot as AppState['dynamicTaskBank'] };
  }
  if (entityType === 'taskLogs' && isRecord(snapshot)) {
    return { ...state, taskLogs: snapshot as AppState['taskLogs'] };
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
