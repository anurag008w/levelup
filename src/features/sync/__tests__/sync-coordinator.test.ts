import { describe, it, expect, beforeEach } from 'vitest';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import type { ChatSession } from '../../../core/domain/chat';
import type { AuthSession } from '../../../lib/auth';
import { SyncCoordinator } from '../sync-coordinator';
import { SyncService, type SyncScope, type SyncPushResult } from '../sync.service';

const SESSION: AuthSession = {
  serverUrl: 'https://example.com',
  username: 'testuser',
  role: 'user',
  isSuperAdmin: false,
  apiKey: 'sk-test',
  token: 'jwt-test',
  loggedInAt: '2026-01-01T00:00:00.000Z',
};

class FakeSync extends SyncService {
  scopesOnServer: SyncScope[] = [];
  serverState: Partial<Record<SyncScope, unknown>> = {};
  pushes: Array<{ scope: SyncScope; state: unknown }> = [];
  deletes: SyncScope[] = [];
  failNext = false;

  constructor() {
    super({} as never);
  }

  override async scopes(_s: AuthSession): Promise<SyncScope[]> {
    return this.scopesOnServer;
  }

  override async pull(_s: AuthSession, scope: SyncScope) {
    if (this.serverState[scope] === undefined) return null;
    return { updatedAt: '2026-01-02T00:00:00.000Z', state: this.serverState[scope] };
  }

  override async push(_s: AuthSession, scope: SyncScope, state: unknown): Promise<SyncPushResult> {
    this.pushes.push({ scope, state });
    if (this.failNext) return { ok: false, updatedAt: '', status: 500, message: 'boom' };
    return { ok: true, updatedAt: '2026-01-02T00:00:00.000Z' };
  }

  override async wipe(_s: AuthSession, _scope?: SyncScope): Promise<boolean> {
    return true;
  }
}

function makeCoordinator(fake: FakeSync, overrides: Partial<Parameters<SyncCoordinator['attach']>[0] & object> = {}) {
  return new SyncCoordinator(fake as SyncService, {
    getState: () => state,
    getChatSessions: () => chat,
    replaceStore: (sessions) => {
      chat = sessions;
    },
    replaceState: (s) => {
      state = s as AppState;
    },
    ...overrides,
  });
}

let state: AppState = emptyAppState();
let chat: ChatSession[] = [];

describe('SyncCoordinator', () => {
  beforeEach(() => {
    state = emptyAppState();
    chat = [];
  });

  it('fresh install pulls server data (no meaningful local state)', async () => {
    const fake = new FakeSync();
    fake.scopesOnServer = ['state'];
    fake.serverState.state = { ...emptyAppState(), startDateISO: '2026-01-01' };
    const coord = makeCoordinator(fake);
    await coord.attach(SESSION);
    // Small wait so the async initialSync settles.
    await new Promise((r) => setTimeout(r, 0));
    expect(state.startDateISO).toBe('2026-01-01');
    expect(fake.pushes).toHaveLength(0);
  });

  it('existing user seeds the server (has local data → push, no pull)', async () => {
    const fake = new FakeSync();
    state = { ...emptyAppState(), startDateISO: '2026-01-01', customHabits: [] };
    fake.scopesOnServer = [];
    const coord = makeCoordinator(fake);
    await coord.attach(SESSION);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.pushes.length).toBeGreaterThanOrEqual(1);
    expect(fake.pushes.some((p) => p.scope === 'state')).toBe(true);
  });

  it('existing user seeds chat only when sessions exist', async () => {
    const fake = new FakeSync();
    state = { ...emptyAppState(), startDateISO: '2026-01-01' };
    chat = [{ id: 's1', title: 't', messages: [], prefs: {} as never, createdAt: '', updatedAt: '' }];
    const coord = makeCoordinator(fake);
    await coord.attach(SESSION);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.pushes.some((p) => p.scope === 'chat')).toBe(true);
  });

  it('fresh install with empty server leaves local untouched', async () => {
    const fake = new FakeSync();
    fake.scopesOnServer = [];
    const coord = makeCoordinator(fake);
    await coord.attach(SESSION);
    await new Promise((r) => setTimeout(r, 0));
    expect(state.startDateISO).toBeNull();
    expect(fake.pushes).toHaveLength(0);
  });

  it('failed seed marks state error and retries on next dirty', async () => {
    const fake = new FakeSync();
    fake.failNext = true;
    state = { ...emptyAppState(), startDateISO: '2026-01-01' };
    const coord = makeCoordinator(fake);
    await coord.attach(SESSION);
    await new Promise((r) => setTimeout(r, 0));
    expect(coord.getScopeState('state').state).toBe('error');
    fake.failNext = false;
    coord.markDirty('state');
    await new Promise((r) => setTimeout(r, 2200));
    expect(coord.getScopeState('state').lastError).toBeNull();
  });

  it('attach with skipInitialSync does not pull or seed', async () => {
    const fake = new FakeSync();
    fake.scopesOnServer = ['state'];
    fake.serverState.state = { ...emptyAppState(), startDateISO: '2026-01-01' };
    state = { ...emptyAppState(), startDateISO: '2026-01-02' };
    const coord = makeCoordinator(fake);
    await coord.attach(SESSION, { skipInitialSync: true });
    await new Promise((r) => setTimeout(r, 0));
    // Local state is left untouched (no pull) and nothing is pushed (no seed).
    expect(state.startDateISO).toBe('2026-01-02');
    expect(fake.pushes).toHaveLength(0);
    // Coordinator is still attached for future edits.
    expect(coord.isAttached).toBe(true);
  });
});
