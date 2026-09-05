// @vitest-environment jsdom
/**
 * Full-stack sync integration test: builds the REAL container (createContainer)
 * with an in-memory fake sync server and drives real mutations through the
 * actual services (chat delete, memory add/delete, progress ticks, task
 * rename/delete, settings) — asserting the coordinator pushes / pulls / wipes
 * the right scopes over HTTP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import type { HttpClient, HttpRequestInit } from '../../../infra/ai/http';
import type { SyncScope } from '../sync.service';
import type { AuthSession } from '../../../lib/auth';
import type { AppContainer } from '../../../di/container';

const SESSION: AuthSession = {
  serverUrl: 'https://sync.test',
  username: 'testuser',
  role: 'user',
  isSuperAdmin: false,
  apiKey: 'sk-test',
  token: 'jwt-test',
  loggedInAt: '2026-01-01T00:00:00.000Z',
};

/** In-memory replica of the SmartRotator sync server. */
type UserScopes = Partial<Record<SyncScope, { state: unknown; updatedAt: string }>>;

class FakeSyncServer implements HttpClient {
  perUser: Map<string, UserScopes> = new Map();
  pushes: Array<{ scope: SyncScope; body: unknown }> = [];
  wipes: number = 0;
  failNext = false;

  private key(username: string): UserScopes {
    if (!this.perUser.has(username)) this.perUser.set(username, {});
    return this.perUser.get(username)!;
  }

  async requestJson<T>(init: HttpRequestInit): Promise<T> {
    if (this.failNext) {
      this.failNext = false;
      const err = new Error('boom') as Error & { status: number };
      err.status = 500;
      throw err;
    }
    const url = new URL(init.url);
    const scope = (url.searchParams.get('scope') ?? 'state') as string;
    const username = SESSION.username;
    const u = this.key(username);

    if (url.pathname.endsWith('/sync/status')) {
      const rec = u[scope as SyncScope];
      return {
        username,
        exists: rec !== undefined,
        updated_at: rec?.updatedAt ?? '',
        bytes: rec ? JSON.stringify(rec.state).length : 0,
      } as T;
    }
    if (url.pathname.endsWith('/sync/scopes')) {
      return { username, scopes: Object.keys(u) } as T;
    }
    if (url.pathname.endsWith('/sync/state') && (init.method ?? 'GET') === 'GET') {
      const rec = u[scope as SyncScope];
      return {
        username,
        scope,
        exists: rec !== undefined,
        updated_at: rec?.updatedAt ?? '',
        state: rec?.state ?? {},
      } as T;
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
  const { reloadPersistentStore } = await import('../../../infra/storage/local-storage');
  await reloadPersistentStore();
  const server = new FakeSyncServer();
  const { createContainer } = await import('../../../di/container');
  const app = createContainer(server, { syncDebounceMs: 5 });
  return { app, server };
}

function started(): AppState {
  const s = emptyAppState();
  s.startDateISO = '2026-01-01';
  return s;
}

async function settle(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

let app: AppContainer;
let server: FakeSyncServer;

describe('sync integration — user lifecycle', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
  });

  afterEach(async () => {
    try {
      app?.syncCoordinator?.detach();
    } catch {}
    vi.resetModules();
    localStorage.clear();
  });

  it('new user (empty local) pulls server state + chat on attach', async () => {
    const remoteState = started();
    remoteState.customHabits = [{ id: 'h1', name: 'Test', anchor: 'daily' } as never];
    server.perUser.set(SESSION.username, {
      state: { state: remoteState, updatedAt: '2026-01-02T00:00:00.000Z' },
      chat: { state: { version: 1, sessions: [{ id: 's1', title: 'Hi', messages: [], createdAt: '', updatedAt: '' }] }, updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    await app.syncCoordinator.attach(SESSION);
    await settle();
    expect(app.store.get().startDateISO).toBe('2026-01-01');
    expect(app.store.get().customHabits).toHaveLength(1);
    expect(app.chat.listSessions()).toHaveLength(1);
    // Fresh install pulls, does NOT push back.
    expect(server.pushes).toHaveLength(0);
  });

  it('new user with empty server stays untouched', async () => {
    await app.syncCoordinator.attach(SESSION);
    await settle();
    expect(app.store.get().startDateISO).toBeNull();
    expect(server.pushes).toHaveLength(0);
  });

  it('existing user (has local data) seeds state + chat to server on attach', async () => {
    app.store.save(started());
    app.chat.createSession('My chat');
    await app.syncCoordinator.attach(SESSION);
    await settle();
    expect(server.pushes.length).toBeGreaterThanOrEqual(2);
    const scopes = new Set(server.pushes.map((p) => p.scope));
    expect(scopes.has('state')).toBe(true);
    expect(scopes.has('chat')).toBe(true);
  });

  it('existing user with data does NOT overwrite local state from server', async () => {
    server.perUser.set(SESSION.username, {
      state: { state: { ...started(), studyTimeMinutes: 999 }, updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    const local = started();
    local.studyTimeMinutes = 360;
    app.store.save(local);
    await app.syncCoordinator.attach(SESSION);
    await settle();
    // Local wins — server data must never clobber a device with data.
    expect(app.store.get().studyTimeMinutes).toBe(360);
  });
});

describe('sync integration — chat mutations', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    app.store.save(started());
    await app.syncCoordinator.attach(SESSION);
    await settle();
    server.pushes = [];
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('creating a chat pushes the chat scope', async () => {
    app.chat.createSession('New chat');
    await settle();
    const chatPush = server.pushes.find((p) => p.scope === 'chat');
    expect(chatPush).toBeTruthy();
    const sessions = (chatPush!.body as { sessions: Array<{ title: string }> }).sessions;
    expect(sessions.some((s) => s.title === 'New chat')).toBe(true);
  });

  it('deleting ONE chat pushes chat scope without it', async () => {
    const keep = app.chat.createSession('Keep me');
    const gone = app.chat.createSession('Delete me');
    await settle();
    server.pushes = [];
    app.chat.deleteSession(gone.id);
    await settle();
    const chatPush = server.pushes.find((p) => p.scope === 'chat');
    const sessions = (chatPush!.body as { sessions: Array<{ id: string }> }).sessions;
    expect(sessions.some((s) => s.id === gone.id)).toBe(false);
    expect(sessions.some((s) => s.id === keep.id)).toBe(true);
  });

  it('deleting ALL chats pushes an empty chat scope', async () => {
    const a = app.chat.createSession('A');
    const b = app.chat.createSession('B');
    await settle();
    server.pushes = [];
    app.chat.deleteSession(a.id);
    app.chat.deleteSession(b.id);
    await settle();
    const chatPush = server.pushes.find((p) => p.scope === 'chat');
    expect((chatPush!.body as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('clearing a chat pushes the trimmed session', async () => {
    const s = app.chat.createSession('Chat');
    const session = app.chat.getSession(s.id)!;
    session.messages.push({ id: 'm1', role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00.000Z' });
    await settle();
    server.pushes = [];
    app.chat.clearSession(s.id);
    await settle();
    const chatPush = server.pushes.find((p) => p.scope === 'chat');
    const sessions = (chatPush!.body as { sessions: Array<{ id: string; messages: unknown[] }> }).sessions;
    const hit = sessions.find((x) => x.id === s.id);
    expect(hit?.messages).toHaveLength(0);
  });
});

describe('sync integration — state mutations', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    app.store.save(started());
    await app.syncCoordinator.attach(SESSION);
    await settle();
    server.pushes = [];
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('progress tick on today (taskLogs) pushes state scope', async () => {
    const s = app.store.get();
    s.taskLogs['2026-01-01'] = { ['task-1']: true };
    app.store.save(s);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect(statePush).toBeTruthy();
    const pushed = statePush!.body as AppState;
    expect(pushed.taskLogs['2026-01-01']['task-1']).toBe(true);
  });

  it('unticking a task pushes state without it', async () => {
    const s = app.store.get();
    s.taskLogs['2026-01-01'] = { ['task-1']: true, ['task-2']: true };
    app.store.save(s);
    await settle();
    server.pushes = [];
    const s2 = app.store.get();
    delete s2.taskLogs['2026-01-01']['task-1'];
    app.store.save(s2);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).taskLogs['2026-01-01']['task-1']).toBeUndefined();
  });

  it('task rename pushes updated dynamicTaskBank', async () => {
    const s = app.store.get();
    s.dynamicTaskBank = [{ id: 'dt1', title: 'Old name', habitId: 'h1' } as never];
    app.store.save(s);
    await settle();
    server.pushes = [];
    const s2 = app.store.get();
    s2.dynamicTaskBank = [{ ...s2.dynamicTaskBank[0], title: 'New name' } as never];
    app.store.save(s2);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    const bank = (statePush!.body as AppState).dynamicTaskBank;
    expect(bank[0].title).toBe('New name');
  });

  it('deleting a custom task pushes state without it', async () => {
    const s = app.store.get();
    s.dynamicTaskBank = [{ id: 'dt1', title: 'Task', habitId: 'h1' } as never];
    app.store.save(s);
    await settle();
    server.pushes = [];
    const s2 = app.store.get();
    s2.dynamicTaskBank = [];
    app.store.save(s2);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).dynamicTaskBank).toHaveLength(0);
  });

  it('adding a memory entry pushes state with the entry', async () => {
    const next = app.memory.add(app.store.get(), {
      type: 'observation',
      content: 'Student struggles with physics',
      source: 'user',
      importance: 8,
    });
    app.store.save(next);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    const entries = (statePush!.body as AppState).memory.entries;
    expect(entries.some((e) => e.content === 'Student struggles with physics')).toBe(true);
  });

  it('deleting a memory entry pushes state without it', async () => {
    const next = app.memory.add(app.store.get(), {
      type: 'observation',
      content: 'Temporary note',
      source: 'user',
      importance: 1,
    });
    app.store.save(next);
    await settle();
    server.pushes = [];
    const entryId = app.store.get().memory.entries[0].id;
    app.store.save(app.memory.remove(app.store.get(), entryId));
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).memory.entries).toHaveLength(0);
  });
});

describe('sync integration — settings', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    app.store.save(started());
    await app.syncCoordinator.attach(SESSION);
    await settle();
    server.pushes = [];
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('toggling AI off pushes state', async () => {
    app.providerSettings.setAiEnabled(false);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).aiSettings.aiEnabled).toBe(false);
  });

  it('adding a custom provider pushes state with it', async () => {
    app.providerSettings.upsertProvider({
      id: 'custom',
      label: 'My Provider',
      baseUrl: 'https://x.test/v1',
      apiKey: 'sk-abc',
      model: 'm1',
      enabled: true,
      hidden: false,
    });
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).aiSettings.providers.custom.label).toBe('My Provider');
  });

  it('changing chat preferences pushes state', async () => {
    app.providerSettings.setAiEnabled(false);
    const s = app.store.get();
    s.aiSettings.chat.autoSaveChats = false;
    app.store.save(s);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).aiSettings.chat.autoSaveChats).toBe(false);
  });

  it('study time change pushes state', async () => {
    const s = app.store.get();
    s.studyTimeMinutes = 480;
    app.store.save(s);
    await settle();
    const statePush = server.pushes.find((p) => p.scope === 'state');
    expect((statePush!.body as AppState).studyTimeMinutes).toBe(480);
  });
});

describe('sync integration — failures, offline, wipe', () => {
  beforeEach(async () => {
    ({ app, server } = await freshContainer());
    app.store.save(started());
    await app.syncCoordinator.attach(SESSION);
    await settle();
    server.pushes = [];
  });

  afterEach(() => {
    try {
      app?.syncCoordinator?.detach();
    } catch {}
    vi.resetModules();
    localStorage.clear();
  });

  it('failed push marks error scope state and retries on next dirty', async () => {
    server.failNext = true;
    const s = app.store.get();
    s.studyTimeMinutes = 999;
    app.store.save(s);
    await settle();
    expect(app.syncCoordinator.getScopeState('state').state).toBe('error');
    // Next mutation succeeds and flushes.
    const s2 = app.store.get();
    s2.studyTimeMinutes = 1000;
    app.store.save(s2);
    await settle();
    expect(app.syncCoordinator.getScopeState('state').lastError).toBeNull();
  });

  it('manual sync now pushes both scopes even with no edits', async () => {
    await app.syncCoordinator.syncNow();
    await settle();
    const scopes = new Set(server.pushes.map((p) => p.scope));
    expect(scopes.has('state')).toBe(true);
    expect(scopes.has('chat')).toBe(true);
  });

  it('logout wipe deletes the whole user sync folder', async () => {
    const ok = await app.sync.wipe(SESSION);
    expect(ok).toBe(true);
    expect(server.wipes).toBe(1);
    expect(server.perUser.has(SESSION.username)).toBe(false);
  });

  it('markDirty before attach is ignored (guest mode)', async () => {
    const fresh = await freshContainer();
    const guestApp = fresh.app;
    const s = guestApp.store.get();
    s.studyTimeMinutes = 111;
    guestApp.store.save(s);
    await settle();
    expect(fresh.server.pushes).toHaveLength(0);
  });
});
