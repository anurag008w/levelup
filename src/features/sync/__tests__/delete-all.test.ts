// @vitest-environment jsdom
/**
 * "Delete all data" integration test: builds the REAL container with an
 * in-memory fake sync server, seeds progress + chat + a custom provider, then
 * runs deleteAllData and asserts:
 *  - local state resets to the default (empty) stage
 *  - chat sessions are cleared
 *  - server backup is wiped
 *  - login session + default server AI credentials survive
 *  - the coordinator re-attaches WITHOUT pulling the wiped data back
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

  private key(username: string): UserScopes {
    if (!this.perUser.has(username)) this.perUser.set(username, {});
    return this.perUser.get(username)!;
  }

  async requestJson<T>(init: HttpRequestInit): Promise<T> {
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

async function freshContainer() {
  vi.resetModules();
  localStorage.clear();
  const server = new FakeSyncServer();
  const { createContainer } = await import('../../../di/container');
  const app = createContainer(server, { syncDebounceMs: 5 });
  return { app, server };
}

function seededState(): AppState {
  const s = emptyAppState();
  s.startDateISO = '2026-01-01';
  s.taskLogs = { '2026-01-01': { done: { task1: true } } as never };
  s.memory = { entries: [{ id: 'm1', type: 'journal', createdAt: '', content: 'x', importance: 0.5, summarized: false, source: 'user', context: { tags: [] } }], summaries: [], lastSummarizedAt: null };
  s.studyTimeMinutes = 480;
  return s;
}

async function settle(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

let app: AppContainer;
let server: FakeSyncServer;

describe('delete all data — logged-in user', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    // Seed local data as an existing user (so attach seeds the server too).
    app.store.save(seededState());
    app.chat.replaceStore([
      {
        id: 's1',
        title: 'Old chat',
        messages: [{ id: 'msg1', role: 'user', content: 'hi', createdAt: '' }],
        prefs: {} as never,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    app.providerSettings.upsertProvider({
      id: 'custom',
      label: 'My Provider',
      baseUrl: 'https://x.test/v1',
      apiKey: 'sk-abc',
      model: 'm1',
      enabled: true,
      hidden: false,
    });
    await app.syncCoordinator.attach(SESSION);
    await settle();
    // Everything above is now backed up on the server.
    expect(server.perUser.has(SESSION.username)).toBe(true);
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('wipes server data and resets local state + chat to default', async () => {
    await deleteAllData(app, SESSION);
    await settle();

    expect(server.wipes).toBe(1);
    expect(server.perUser.has(SESSION.username)).toBe(false);

    const state = app.store.get();
    expect(state.startDateISO).toBeNull();
    expect(state.taskLogs).toEqual({});
    expect(state.memory.entries).toHaveLength(0);
    expect(state.studyTimeMinutes).toBe(360);
    expect(app.chat.listSessions()).toHaveLength(0);
  });

  it('preserves the default server AI credentials (hidden provider)', async () => {
    await deleteAllData(app, SESSION);
    await settle();

    const hidden = app.providerSettings.getHiddenDefaultFull();
    expect(hidden).not.toBeNull();
    expect(hidden!.baseUrl).toContain('sync.test');
    expect(hidden!.apiKey).toBe('sk-test');
    expect(app.providerSettings.getActiveProvider()?.id).toBe(hidden!.id);
    expect(app.store.get().aiSettings.aiEnabled).toBe(true);
  });

  it('does NOT pull the wiped server data back (stays at default stage)', async () => {
    await deleteAllData(app, SESSION);
    await settle();

    // Coordinator is attached (session kept) but must not resurrect anything.
    expect(app.syncCoordinator.isAttached).toBe(true);
    const state = app.store.get();
    expect(state.startDateISO).toBeNull();
    expect(app.chat.listSessions()).toHaveLength(0);
  });

  it('fresh edits after delete-all push the new default state up', async () => {
    await deleteAllData(app, SESSION);
    await settle();
    server.pushes = [];

    const s = app.store.get();
    s.studyTimeMinutes = 300;
    app.store.save(s);
    await settle();

    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect(statePush).toBeDefined();
    expect((statePush!.body as AppState).studyTimeMinutes).toBe(300);
    expect((statePush!.body as AppState).startDateISO).toBeNull();
  });

  it('custom provider added before the wipe is gone afterwards', async () => {
    await deleteAllData(app, SESSION);
    await settle();
    expect(app.store.get().aiSettings.providers.custom).toBeUndefined();
  });
});

describe('delete all data — guest (no session)', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    app.store.save(seededState());
    app.chat.replaceStore([
      {
        id: 's1',
        title: 'Guest chat',
        messages: [],
        prefs: {} as never,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('resets local data without any server calls', async () => {
    await deleteAllData(app, null);

    expect(server.wipes).toBe(0);
    expect(server.perUser.has(SESSION.username)).toBe(false);
    expect(app.store.get().startDateISO).toBeNull();
    expect(app.chat.listSessions()).toHaveLength(0);
    // Guest has no session, so the coordinator stays detached.
    expect(app.syncCoordinator.isAttached).toBe(false);
  });
});

describe('delete all data — transactional rollback (N3)', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    localStorage.setItem('levelup.data-owner', 'testuser');
    app.store.save(seededState());
    app.chat.replaceStore([
      {
        id: 's1',
        title: 'Old chat',
        messages: [{ id: 'msg1', role: 'user', content: 'hi', createdAt: '' }],
        prefs: {} as never,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await app.syncCoordinator.attach(SESSION);
    await settle();
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('restores chat + state + owner when a mid-sequence step throws', async () => {
    // Force the WIPE call itself (replaceStore([])) to fail.
    const spy = vi.spyOn(app.chat, 'replaceStore').mockImplementationOnce(() => {
      throw new Error('storage write failed');
    });

    await expect(deleteAllData(app, SESSION)).rejects.toThrow('storage write failed');
    expect(spy).toHaveBeenCalled();

    // Rollback restored the full pre-delete data.
    expect(app.chat.listSessions()).toHaveLength(1);
    expect(app.chat.listSessions()[0].id).toBe('s1');
    expect(app.store.get().startDateISO).toBe('2026-01-01');
    expect(app.store.get().taskLogs).toEqual({ '2026-01-01': { done: { task1: true } } as never });
    expect(localStorage.getItem('levelup.data-owner')).toBe('testuser');
    // Sync is attached again with the same session.
    expect(app.syncCoordinator.isAttached).toBe(true);
    expect(app.syncCoordinator.getSession()?.username).toBe('testuser');
  });

  it('restores everything when re-applying server auth throws (no half-wipe)', async () => {
    vi.spyOn(app.providerSettings, 'configureServerAuth').mockImplementationOnce(() => {
      throw new Error('auth failed');
    });

    await expect(deleteAllData(app, SESSION)).rejects.toThrow('auth failed');

    // Nothing is left half-deleted: state + chat are intact.
    expect(app.store.get().startDateISO).toBe('2026-01-01');
    expect(app.store.get().studyTimeMinutes).toBe(480);
    expect(app.chat.listSessions()).toHaveLength(1);
    // Re-attach re-seeds the (wiped) server backup from the restored data.
    await settle();
    expect(server.perUser.has(SESSION.username)).toBe(true);
  });

  it('the wipe is durable immediately — no debounce window that resurrects data', async () => {
    await deleteAllData(app, SESSION);
    // No settle(): reload() re-reads localStorage, which must already be empty
    // because deleteAllData flushed the wipe before resolving.
    const reloaded = app.store.reload();
    expect(reloaded.startDateISO).toBeNull();
    expect(reloaded.taskLogs).toEqual({});
    expect(reloaded.memory.entries).toHaveLength(0);
    expect(reloaded.studyTimeMinutes).toBe(360);
  });
});
