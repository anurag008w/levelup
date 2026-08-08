// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { phaseAccent } from '../phaseColors';
import { canAutoUnlockSession, isAdminUnlocked, setAdminUnlocked, verifyAdminLogin } from '../admin';
import { container } from '../../di/container';
import { MOCK_TEST_PROTOCOL, EXAM_MONTH_PROTOCOL } from '../../data/protocols';

describe('phaseColors', () => {
  it('maps every phase color to a hex color (call sites append alpha-suffix hex digits, which requires real hex, not var())', () => {
    expect(phaseAccent('l')).toBe('#a31313');
    expect(phaseAccent('light')).toBe('#efe9df');
    expect(phaseAccent('peak')).toBe('#efe9df');
    expect(phaseAccent('core')).toBe('#a31313');
  });
});

describe('admin gate (server-backed, no hardcoded credentials)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('auto-unlocks only for server super admins — role alone is not enough', () => {
    expect(canAutoUnlockSession({ isSuperAdmin: true, role: 'admin' })).toBe(true);
    expect(canAutoUnlockSession({ isSuperAdmin: true })).toBe(true);
    expect(canAutoUnlockSession({ isSuperAdmin: false, role: 'admin' })).toBe(false);
    expect(canAutoUnlockSession({ role: 'admin' })).toBe(false);
    expect(canAutoUnlockSession({ isSuperAdmin: false })).toBe(false);
    expect(canAutoUnlockSession(null)).toBe(false);
    expect(canAutoUnlockSession(undefined)).toBe(false);
  });

  it('verifyAdminLogin unlocks when the server account is a super admin', async () => {
    const spy = vi
      .spyOn(container.http as never as { requestJson: (init: unknown) => Promise<unknown> }, 'requestJson')
      .mockResolvedValue({
        token: 't',
        api_key: 'k',
        user: { username: 'ADMIN_1', role: 'admin' },
        is_super_admin: true,
      });
    const res = await verifyAdminLogin('  ADMIN_1  ', 'secret');
    expect(res.ok).toBe(true);
    // The trimmed username is sent to the server.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ body: { username: 'ADMIN_1', password: 'secret' } }));
  });

  it('verifyAdminLogin rejects a non-super-admin account with a clear message', async () => {
    vi.spyOn(container.http as never as { requestJson: (init: unknown) => Promise<unknown> }, 'requestJson').mockResolvedValue({
      token: 't',
      api_key: 'k',
      user: { username: 'normal_user', role: 'user' },
      is_super_admin: false,
    });
    const res = await verifyAdminLogin('normal_user', 'pw');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/super admin/);
  });

  it('verifyAdminLogin surfaces server/auth errors', async () => {
    vi.spyOn(container.http as never as { requestJson: (init: unknown) => Promise<unknown> }, 'requestJson').mockRejectedValue(
      new Error('Username ya password galat hai.'),
    );
    const res = await verifyAdminLogin('x', 'y');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/galat/i);
  });

  it('per-user unlock flags are independent', () => {
    expect(isAdminUnlocked('admin_1')).toBe(false);
    setAdminUnlocked('admin_1', true);
    expect(isAdminUnlocked('admin_1')).toBe(true);
    expect(isAdminUnlocked('admin_2')).toBe(false); // other user unaffected
    expect(isAdminUnlocked(null)).toBe(false); // guest unaffected
    setAdminUnlocked('admin_1', false);
    expect(isAdminUnlocked('admin_1')).toBe(false);
  });

  it('guest (null user) uses its own flag', () => {
    setAdminUnlocked(null, true);
    expect(isAdminUnlocked(null)).toBe(true);
    expect(isAdminUnlocked('someone')).toBe(false);
  });
});

describe('protocol data integrity', () => {
  it('mock test protocol items are unique and non-empty', () => {
    const ids = MOCK_TEST_PROTOCOL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MOCK_TEST_PROTOCOL.length).toBe(5);
    expect(MOCK_TEST_PROTOCOL.every((p) => p.id && p.text.length > 0)).toBe(true);
  });

  it('exam month protocol items are unique and non-empty', () => {
    const ids = EXAM_MONTH_PROTOCOL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EXAM_MONTH_PROTOCOL.length).toBe(6);
    expect(EXAM_MONTH_PROTOCOL.every((p) => p.id && p.text.length > 0)).toBe(true);
  });
});
