// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { container } from '../../di/container';
import { emptyAppState } from '../../core/domain/state';
import { isoAddDays } from '../../features/habit-engine/dates';
import { useAppState } from '../useAppState';
import { saveSession } from '../auth';

const http = container.http as unknown as { requestJson: (init: unknown) => Promise<unknown> };

/** Stubs the server /auth/login response for a super admin or a normal user. */
function mockServerAuth(isSuperAdmin: boolean) {
  vi.spyOn(http, 'requestJson').mockResolvedValue({
    token: 't',
    api_key: 'k',
    user: { username: 'admin_1', role: isSuperAdmin ? 'admin' : 'user' },
    is_super_admin: isSuperAdmin,
  });
}

function superAdminSession() {
  saveSession({
    serverUrl: 'https://sync.test',
    username: 'admin_1',
    role: 'admin',
    isSuperAdmin: true,
    apiKey: 'k',
    token: 't',
    loggedInAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('useAppState', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  it('boots from the container store with a real today', () => {
    const { result } = renderHook(() => useAppState());
    expect(result.current.state).toEqual(emptyAppState());
    expect(result.current.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('update applies the updater and persists to the store', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.update((s) => ({ ...s, bonusDaysUsed: 3 }));
    });
    expect(result.current.state.bonusDaysUsed).toBe(3);
    expect(container.store.get().bonusDaysUsed).toBe(3);
  });

  it('startJourney stamps today as the start date', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.startJourney();
    });
    expect(result.current.state.startDateISO).toBe(result.current.today);
  });

  it('admin preview rewinds/pushes today to the previewed journey day', async () => {
    const start = '2026-01-01';
    container.store.save({ ...emptyAppState(), startDateISO: start });
    mockServerAuth(true);
    const { result } = renderHook(() => useAppState());
    expect(result.current.adminUnlocked).toBe(false);

    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await result.current.unlockAdmin('admin_1', 'pw');
    });
    expect(res?.ok).toBe(true);
    expect(result.current.adminUnlocked).toBe(true);

    act(() => {
      result.current.setAdminDay(5);
    });
    expect(result.current.today).toBe(isoAddDays(start, 4)); // day 5 → start + 4

    act(() => {
      result.current.lockAdmin();
    });
    expect(result.current.adminUnlocked).toBe(false);
    expect(result.current.today).not.toBe(isoAddDays(start, 4));
  });

  it('rejects a non-super-admin account without unlocking', async () => {
    mockServerAuth(false);
    const { result } = renderHook(() => useAppState());

    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await result.current.unlockAdmin('normal', 'nope');
    });
    expect(res?.ok).toBe(false);
    expect(result.current.adminUnlocked).toBe(false);
  });

  it('autoUnlock unlocks for a stored super-admin session (no dialog)', () => {
    superAdminSession();
    const { result } = renderHook(() => useAppState());
    expect(result.current.adminUnlocked).toBe(false);

    let ok = false;
    act(() => {
      ok = result.current.autoUnlock();
    });
    expect(ok).toBe(true);
    expect(result.current.adminUnlocked).toBe(true);
  });

  it('autoUnlock refuses when the session is a normal user', () => {
    saveSession({
      serverUrl: 'https://sync.test',
      username: 'normal',
      role: 'user',
      isSuperAdmin: false,
      apiKey: 'k',
      token: 't',
      loggedInAt: '2026-01-01T00:00:00.000Z',
    });
    const { result } = renderHook(() => useAppState());

    let ok = true;
    act(() => {
      ok = result.current.autoUnlock();
    });
    expect(ok).toBe(false);
    expect(result.current.adminUnlocked).toBe(false);
  });

  it('refresh re-reads the store after external mutations', () => {
    const { result } = renderHook(() => useAppState());
    container.store.save({ ...emptyAppState(), startDateISO: '2026-02-02' });
    act(() => {
      result.current.refresh();
    });
    expect(result.current.state.startDateISO).toBe('2026-02-02');
  });
});
