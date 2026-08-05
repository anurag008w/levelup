// SyncCoordinator — orchestrates when the app pushes to / pulls from the
// server. Owns the debounce, the online/offline listener and the fresh-install
// recovery, so the UI just has to call attach()/detach() on login/logout.
//
// Lifecycle:
//   attach(session)  → after login. Pulls server data when the local store is
//                      fresh (empty install), then starts marking dirty scopes.
//   detach()         → before logout. Stops scheduling (wipe is caller-owned).
//   markDirty(scope) → called by the storage wrappers on every mutation.
//
// Scopes: `state` covers the whole AppState (plan, tasks, logs, memory,
// profile, aiSettings incl. providers) — the server stores it under
// data/sync/<user>/state.json. `chat` covers chat sessions under chat.json.

import type { AuthSession } from '../../lib/auth';
import type { AppState } from '../../core/domain/state';
import type { ChatSession } from '../../core/domain/chat';
import { SyncService, stateSyncPayload, type SyncScope, type SyncScopeState } from './sync.service';

/** Push coalescing window — mutations within this span ride one request. */
const PUSH_DEBOUNCE_MS = 2_000;

export class SyncCoordinator {
  private readonly sync: SyncService;
  private readonly getState: () => AppState;
  private readonly getChatSessions: () => ChatSession[];
  private readonly replaceStore: (sessions: ChatSession[]) => void;
  private readonly replaceState: (state: unknown) => void;
  private readonly debounceMs: number;

  private session: AuthSession | null = null;
  private dirty = new Set<SyncScope>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  /** True while restoring server data — suppress dirty so a pull never pushes back. */
  private restoring = false;
  /**
   * True once the initial reconcile (pull on fresh install / seed for existing
   * users) has run for the current session. Attaching offline defers it; the
   * first time the connection comes back we run it so server data isn't missed.
   * skipInitialSync (full data wipe) marks it done immediately — nothing to pull.
   */
  private initialSyncDone = false;
  private online = !(typeof navigator !== 'undefined' && navigator.onLine === false);
  private listeners = new Set<() => void>();
  private scopeStates = new Map<SyncScope, SyncScopeState>();

  constructor(
    sync: SyncService,
    deps: {
      getState: () => AppState;
      getChatSessions: () => ChatSession[];
      replaceStore: (sessions: ChatSession[]) => void;
      replaceState: (state: unknown) => void;
    },
    opts: { debounceMs?: number } = {},
  ) {
    this.sync = sync;
    this.getState = deps.getState;
    this.getChatSessions = deps.getChatSessions;
    this.replaceStore = deps.replaceStore;
    this.replaceState = deps.replaceState;
    this.debounceMs = opts.debounceMs ?? PUSH_DEBOUNCE_MS;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private setScopeState(scope: SyncScope, patch: Partial<SyncScopeState>): void {
    const prev = this.scopeStates.get(scope) ?? { scope, state: 'idle', lastSyncedAt: null, lastError: null };
    this.scopeStates.set(scope, { ...prev, ...patch });
  }

  getScopeState(scope: SyncScope): SyncScopeState {
    return this.scopeStates.get(scope) ?? { scope, state: 'idle', lastSyncedAt: null, lastError: null };
  }

  isOnline(): boolean {
    return this.online;
  }

  get isAttached(): boolean {
    return this.session !== null;
  }

  /** Attach after login. Restores from server on a fresh install; seeds the
   *  server with existing local data otherwise. Pass `skipInitialSync: true`
   *  after a full data wipe so the (just-deleted) server copy isn't pulled back. */
  attach(session: AuthSession, opts: { skipInitialSync?: boolean } = {}): void {
    this.session = session;
    this.dirty.clear();
    this.scopeStates.clear();
    if (opts.skipInitialSync) {
      // Full data wipe — the server copy was just deleted; never pull it back.
      this.initialSyncDone = true;
      return;
    }
    if (this.online) {
      this.initialSyncDone = true;
      void this.initialSync(session);
    }
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.session = null;
    this.dirty.clear();
    this.inFlight = false;
    this.initialSyncDone = false;
    this.scopeStates.clear();
    this.emit();
  }

  /** Called by storage wrappers whenever app data changes. */
  markDirty(scope: SyncScope): void {
    if (!this.session) return;
    if (this.restoring) return;
    this.dirty.add(scope);
    if (this.online) {
      this.setScopeState(scope, { state: 'syncing', lastError: null });
      this.schedulePush();
    } else {
      this.setScopeState(scope, { state: 'offline' });
      this.emit();
    }
  }

  /** Manual "Sync now" from the Settings UI. */
  async syncNow(): Promise<void> {
    if (!this.session) return;
    if (this.inFlight) return;
    // Force online status refresh on manual user trigger
    this.online = typeof navigator === 'undefined' || navigator.onLine !== false;
    this.dirty.add('state');
    this.dirty.add('chat');
    await this.flush();
  }

  private schedulePush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    // If we went offline between markDirty and the debounce timer firing,
    // don't waste a request — the reconnect handler will flush.
    if (!this.session || this.inFlight || this.dirty.size === 0 || !this.online) return;
    this.inFlight = true;
    const session = this.session;
    const scopes = [...this.dirty];
    this.dirty.clear();
    try {
      for (const scope of scopes) {
        if (scope === 'chat') {
          await this.pushChat(session);
        } else {
          await this.pushState(session);
        }
      }
    } finally {
      this.inFlight = false;
      this.emit();
    }
  }

  private async pushState(session: AuthSession): Promise<void> {
    const now = new Date().toISOString();
    const res = await this.sync.push(session, 'state', stateSyncPayload(this.getState()), now);
    if (res.ok) {
      this.setScopeState('state', { state: 'online', lastSyncedAt: now, lastError: null });
    } else {
      this.setScopeState('state', { state: 'error', lastError: res.message ?? 'Sync failed' });
      this.dirty.add('state');
    }
  }

  private async pushChat(session: AuthSession): Promise<void> {
    const now = new Date().toISOString();
    const payload = { version: 1, sessions: this.getChatSessions() };
    const res = await this.sync.push(session, 'chat', payload, now);
    if (res.ok) {
      this.setScopeState('chat', { state: 'online', lastSyncedAt: now, lastError: null });
    } else {
      this.setScopeState('chat', { state: 'error', lastError: res.message ?? 'Sync failed' });
      this.dirty.add('chat');
    }
  }

  /**
   * On login (attach): reconcile local vs server.
   *  - Fresh install (no meaningful local data) → pull the server copy down.
   *  - Existing user (has local data) → seed the server with what we have, so
   *    a long-time user's backup appears even before the first edit.
   */
  private async initialSync(session: AuthSession): Promise<void> {
    if (!this.hasMeaningfulData()) {
      await this.pullAll(session);
      return;
    }
    await this.seedServer(session);
  }

  /** True when the local state carries actual user progress (not an empty shell). */
  private hasMeaningfulData(): boolean {
    const state = this.getState();
    if (state.startDateISO !== null) return true;
    if (Object.keys(state.taskLogs ?? {}).length > 0) return true;
    if ((state.memory?.entries ?? []).length > 0) return true;
    if ((state.customHabits ?? []).length > 0) return true;
    if ((state.subjectPlanners ?? []).length > 0) return true;
    if ((state.clearedLevels ?? []).length > 0) return true;
    if ((state.weeklyReviews ?? []).length > 0) return true;
    if ((state.monthlyAssessments ?? []).length > 0) return true;
    return false;
  }

  /** Fresh install: pull every scope the server has for this user. */
  private async pullAll(session: AuthSession): Promise<void> {
    const scopes = await this.sync.scopes(session);
    this.restoring = true;
    try {
      for (const scope of scopes) {
        const remote = await this.sync.pull(session, scope);
        if (!remote) continue;
        if (scope === 'chat') {
          const store = remote.state as { sessions?: ChatSession[] } | undefined;
          const sessions = Array.isArray(store?.sessions) ? store.sessions : [];
          if (sessions.length > 0) this.replaceStore(sessions);
          this.setScopeState('chat', { state: 'online', lastSyncedAt: remote.updatedAt, lastError: null });
        } else {
          this.replaceState(remote.state);
          this.setScopeState('state', { state: 'online', lastSyncedAt: remote.updatedAt, lastError: null });
        }
      }
    } finally {
      this.restoring = false;
    }
    this.emit();
  }

  /**
   * Existing user: push local data up once so the server has a backup. This is
   * push-authoritative — the server never overwrites the app, so seeding is
   * always safe (worst case the server ends up with this device's data).
   */
  private async seedServer(session: AuthSession): Promise<void> {
    const now = new Date().toISOString();
    const stateRes = await this.sync.push(session, 'state', stateSyncPayload(this.getState()), now);
    if (stateRes.ok) {
      this.setScopeState('state', { state: 'online', lastSyncedAt: now, lastError: null });
    } else {
      this.setScopeState('state', { state: 'error', lastError: stateRes.message ?? 'Sync failed' });
    }
    const sessions = this.getChatSessions();
    if (sessions.length > 0) {
      const chatRes = await this.sync.push(session, 'chat', { version: 1, sessions }, now);
      if (chatRes.ok) {
        this.setScopeState('chat', { state: 'online', lastSyncedAt: now, lastError: null });
      } else {
        this.setScopeState('chat', { state: 'error', lastError: chatRes.message ?? 'Sync failed' });
      }
    }
    this.emit();
  }

  private handleOnline(): void {
    this.online = true;
    if (!this.session) return;
    // Attach offline → initialSync was deferred. Now that we're back online:
    //  - dirty edits exist → push-authoritative wins; flush them, never pull
    //    over local changes made while offline.
    //  - no edits → run the deferred initialSync so a fresh install still pulls
    //    its server backup (and an existing user seeds).
    // skipInitialSync marks this done, so nothing pulls after a full wipe.
    if (!this.initialSyncDone) {
      this.initialSyncDone = true;
      if (this.dirty.size === 0) {
        void this.initialSync(this.session);
        return;
      }
    }
    if (this.dirty.size > 0) {
      void this.flush();
    }
  }

  private handleOffline(): void {
    this.online = false;
    for (const scope of this.scopeStates.keys()) {
      this.setScopeState(scope, { state: 'offline' });
    }
    this.emit();
  }
}
