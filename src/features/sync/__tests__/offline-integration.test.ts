// @vitest-environment jsdom
/**
 * Offline / reconnect integration test: builds the REAL container with an
 * in-memory fake sync server and exercises the connection-lost paths:
 *  - attaching while offline (no pull, no push; edits queue as dirty)
 *  - going offline inside the debounce window (no wasted request)
 *  - reconnecting flushes dirty edits (push-authoritative, never pulls over)
 *  - a deferred fresh-install pull runs once the connection returns
 *  - delete-all's skipInitialSync never pulls the wiped server copy back
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import type { HttpClient, HttpRequestInit } from '../../../infra/ai/http';
import type { SyncScope } from '../sync.service';
import type { AuthSession } from '../../../lib/auth';
import type { AppContainer } from '../../../di/container';
import { deleteAllData } from '../delete-all';

const SESSION: AuthSession = {
  serverUrl: 'https://sync.test',
  username: 'testuser',
  role: 'user',
  isSuperAdmin: false,
  apiKey: 'sk-test',
  token: 'jwt-test',
  loggedInAt: '2026-01-01T00:00:00.000Z',
};

type UserScopes = Partial<Record<SyncScope, { state: unknown; updatedAt: string }>>;

class FakeSyncServer implements HttpClient {
  perUser: Map<string, UserScopes> = new Map();
  pushes: Array<{ scope: SyncScope; body: unknown }> = [];
  wipes: number = 0;
  /** Simulates the network: when false, every request throws like a dead connection. */
  networkUp = true;

  private key(username: string): UserScopes {
    if (!this.perUser.has(username)) this.perUser.set(username, {});
    return this.perUser.get(username)!;
  }

  async requestJson<T>(init: HttpRequestInit): Promise<T> {
    if (!this.networkUp) {
      const err = new Error('Network is down') as Error & { status: number };
      err.status = 0;
      throw err;
    }
    const url = new URL(init.url);
    const scope = (url.searchParams.get('scope') ?? 'state') as string;
    const username = SESSION.username;
    const u = this.key(username);

    if (url.pathname.endsWith('/sync/status')) {
      const rec = u[scope as SyncScope];
      return { username, exists: rec !== undefined, updated_at: rec?.updatedAt ?? '', bytes: rec ? JSON.stringify(rec.state).length : 0 } as T;
    }
    if (url.pathname.endsWith('/sync/scopes')) {
      return { username, scopes: Object.keys(u) } as T;
    }
    if (url.pathname.endsWith('/sync/state') && (init.method ?? 'GET') === 'GET') {
      const rec = u[scope as SyncScope];
      return { username, scope, exists: rec !== undefined, updated_at: rec?.updatedAt ?? '', state: rec?.state ?? {} } as T;
    }
    if (url.pathname.endsWith('/sync/state') && init.method === 'PUT') {
      const body = init.body as { state: unknown; updated_at: string };
      this.pushes.push({ scope: scope as SyncScope, body: body.state });
      const updatedAt = body.updated_at ?? new Date().toISOString();
      u[scope as SyncScope] = { state: body.state, updatedAt };
      return { username, scope, updated_at: updatedAt, ok: true } as T;
    }
    if (url.pathname.endsWith('/sync/state') && init.method === 'DELETE') {
      this.wipes += 1;
      if (scope === '*') this.perUser.delete(username);
      else delete u[scope as SyncScope];
      return { username, scope, deleted: true } as T;
    }
    throw new Error(`Unhandled: ${init.method} ${init.url}`);
  }

  async requestSse(): Promise<void> {}
}

/**
 * Drives navigator.onLine + the window online/offline events the coordinator
 * listens to. `setOnline(false)` fires the offline event; `setOnline(true)`
 * fires the online event. Constructor-time state is set via navigator.onLine.
 */
let navigatorOnline = true;
let currentServer: FakeSyncServer | null = null;
function configureNavigator(v: boolean) {
  navigatorOnline = v;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => navigatorOnline });
}
function goOnline() {
  configureNavigator(true);
  if (currentServer) currentServer.networkUp = true;
  window.dispatchEvent(new Event('online'));
}
function goOffline() {
  configureNavigator(false);
  if (currentServer) currentServer.networkUp = false;
  window.dispatchEvent(new Event('offline'));
}

async function freshContainer(initialOnline = true) {
  vi.resetModules();
  localStorage.clear();
  configureNavigator(initialOnline);
  const server = new FakeSyncServer();
  server.networkUp = initialOnline;
  currentServer = server;
  const { createContainer } = await import('../../../di/container');
  const app = createContainer(server, { syncDebounceMs: 5 });
  return { app, server };
}

function started(): AppState {
  const s = emptyAppState();
  s.startDateISO = '2026-01-01';
  return s;
}

async function settle(ms = 40) {
  await new Promise((r) => setTimeout(r, ms));
}

let app: AppContainer;
let server: FakeSyncServer;

describe('offline sync — attach while offline', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer(false));
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
    currentServer = null;
  });

  it('attach while offline neither pulls nor pushes', async () => {
    // Server has data the app must NOT pull while offline.
    server.perUser.set(SESSION.username, {
      state: { state: started(), updatedAt: '2026-01-02T00:00:00.000Z' },
      chat: { state: { version: 1, sessions: [{ id: 's1', title: 'Hi', messages: [], createdAt: '', updatedAt: '' }] }, updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    await app.syncCoordinator.attach(SESSION);
    await settle();
    expect(app.store.get().startDateISO).toBeNull();
    expect(app.chat.listSessions()).toHaveLength(0);
    expect(server.pushes).toHaveLength(0);
    expect(app.syncCoordinator.isAttached).toBe(true);
  });

  it('edits made while offline queue as dirty and flush on reconnect (no pull over them)', async () => {
    await app.syncCoordinator.attach(SESSION);
    // Edit while offline.
    const s = app.store.get();
    s.studyTimeMinutes = 480;
    app.store.save(s);
    await settle();
    expect(server.pushes).toHaveLength(0);
    expect(app.syncCoordinator.getScopeState('state').state).toBe('offline');

    // Reconnect: dirty edits push, and the server's old state must NOT overwrite.
    server.perUser.set(SESSION.username, {
      state: { state: started(), updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    goOnline();
    await settle();
    expect(app.store.get().studyTimeMinutes).toBe(480);
    const push = server.pushes.find((p) => p.scope === 'state');
    expect((push!.body as AppState).studyTimeMinutes).toBe(480);
    expect(app.syncCoordinator.getScopeState('state').state).toBe('online');
  });

  it('fresh install attached offline pulls its server backup once online (no edits)', async () => {
    const remote = started();
    remote.customHabits = [{ id: 'h1', name: 'Test', anchor: 'daily' } as never];
    server.perUser.set(SESSION.username, {
      state: { state: remote, updatedAt: '2026-01-02T00:00:00.000Z' },
      chat: { state: { version: 1, sessions: [{ id: 's1', title: 'Hi', messages: [], createdAt: '', updatedAt: '' }] }, updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    await app.syncCoordinator.attach(SESSION);
    await settle();
    // Still offline: nothing pulled.
    expect(app.store.get().startDateISO).toBeNull();

    goOnline();
    await settle();
    expect(app.store.get().startDateISO).toBe('2026-01-01');
    expect(app.chat.listSessions()).toHaveLength(1);
    expect(server.pushes).toHaveLength(0);
  });
});

describe('offline sync — connection drops mid-flight', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer(true));
    app.store.save(started());
    await app.syncCoordinator.attach(SESSION);
    await settle();
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('going offline inside the debounce window does not fire a failed push', async () => {
    server.pushes = [];
    const s = app.store.get();
    s.studyTimeMinutes = 999;
    app.store.save(s); // markDirty schedules a (5ms) debounced push
    goOffline(); // connection drops before the timer fires
    await settle();
    // No failed request was made while offline.
    expect(server.pushes).toHaveLength(0);
    expect(app.syncCoordinator.getScopeState('state').state).toBe('offline');

    // Reconnect flushes the queued edit.
    goOnline();
    await settle();
    const push = server.pushes.find((p) => p.scope === 'state');
    expect((push!.body as AppState).studyTimeMinutes).toBe(999);
  });

  it('offline edits across multiple drops are all pushed on reconnect', async () => {
    await app.syncCoordinator.attach(SESSION);
    server.pushes = [];

    goOffline();
    const s1 = app.store.get();
    s1.studyTimeMinutes = 400;
    app.store.save(s1);
    await settle();

    goOnline();
    await settle();
    let push = server.pushes.find((p) => p.scope === 'state');
    expect((push!.body as AppState).studyTimeMinutes).toBe(400);

    server.pushes = [];
    goOffline();
    const s2 = app.store.get();
    s2.studyTimeMinutes = 500;
    app.store.save(s2);
    await settle();

    goOnline();
    await settle();
    push = server.pushes.find((p) => p.scope === 'state');
    expect((push!.body as AppState).studyTimeMinutes).toBe(500);
  });

  it('manual sync now while offline is a no-op, then pushes after reconnect', async () => {
    server.pushes = [];
    goOffline();
    await app.syncCoordinator.syncNow();
    expect(server.pushes).toHaveLength(0);

    goOnline();
    await settle();
    const scopes = new Set(server.pushes.map((p) => p.scope));
    expect(scopes.has('state')).toBe(true);
    expect(scopes.has('chat')).toBe(true);
  });
});

describe('offline sync — delete all data safety', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer(true));
    app.store.save(started());
    await app.syncCoordinator.attach(SESSION);
    await settle();
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('delete-all then reconnect does not pull the wiped server copy back', async () => {
    await deleteAllData(app, SESSION);
    await settle();
    expect(server.wipes).toBe(1);
    expect(server.perUser.has(SESSION.username)).toBe(false);

    // Simulate going offline and back online — nothing should resurrect.
    goOffline();
    await settle();
    goOnline();
    await settle();
    expect(app.store.get().startDateISO).toBeNull();
    expect(app.chat.listSessions()).toHaveLength(0);
  });
});
