// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * The module exports a SINGLE PersistentStorage instance (default export) whose
 * in-memory cache survives localStorage.clear(). Re-import the module fresh per
 * test so each test starts from an empty cache + empty localStorage.
 */
async function fresh() {
  vi.resetModules();
  localStorage.clear();
  const mod = await import('../persistent-storage');
  return mod.persistentStorage;
}

describe('PersistentStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('gets null for missing keys', async () => {
    const storage = await fresh();
    expect(await storage.get('missing')).toBeNull();
  });

  it('sets and gets JSON round-trip under the app prefix', async () => {
    const storage = await fresh();
    expect(await storage.set('user', { name: 'Anurag', xp: 100 })).toBe(true);
    expect(await storage.get('user')).toEqual({ name: 'Anurag', xp: 100 });
    // The raw localStorage key carries the prefix.
    expect(localStorage.getItem('@levelup:user')).toBe(JSON.stringify({ name: 'Anurag', xp: 100 }));
  });

  it('returns null for corrupt stored JSON', async () => {
    const storage = await fresh();
    localStorage.setItem('@levelup:bad', '{oops');
    expect(await storage.get('bad')).toBeNull();
  });

  it('removes a key', async () => {
    const storage = await fresh();
    await storage.set('x', 1);
    await storage.remove('x');
    expect(await storage.get('x')).toBeNull();
    expect(localStorage.getItem('@levelup:x')).toBeNull();
  });

  it('clears only prefixed keys', async () => {
    const storage = await fresh();
    await storage.set('a', 1);
    localStorage.setItem('other-app', 'keep me');
    await storage.clear();
    expect(await storage.get('a')).toBeNull();
    expect(localStorage.getItem('other-app')).toBe('keep me');
  });

  it('keys() returns unprefixed key names', async () => {
    const storage = await fresh();
    await storage.set('alpha', 1);
    await storage.set('beta', 2);
    localStorage.setItem('other-app', 'x');
    const keys = await storage.keys();
    expect(keys).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(keys).not.toContain('other-app');
  });

  it('tracks quota errors and exposes the last write error', async () => {
    const storage = await fresh();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      const ok = await storage.set('big', 'x'.repeat(10_000_000));
      expect(ok).toBe(false);
      expect(storage.getLastWriteError()).toContain('Storage full');
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('a successful write clears the last write error', async () => {
    const storage = await fresh();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      await storage.set('big', 'x');
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(storage.getLastWriteError()).not.toBeNull();
    await storage.set('small', 1);
    expect(storage.getLastWriteError()).toBeNull();
  });

  it('a fresh instance reads persisted data back from localStorage', async () => {
    const first = await fresh();
    await first.set('persist', { v: 1 });
    // Force a brand-new module: the new singleton must hydrate from localStorage.
    vi.resetModules();
    const secondMod = await import('../persistent-storage');
    expect(await secondMod.persistentStorage.get('persist')).toEqual({ v: 1 });
  });

  it('reload() re-seeds the cache from localStorage (multi-tab writes)', async () => {
    const storage = await fresh();
    await storage.set('x', { v: 1 });
    // Another tab writes directly to localStorage, bypassing this cache.
    localStorage.setItem('@levelup:x', JSON.stringify({ v: 2 }));
    // Known keys read from the stale cache until reload() is called.
    expect(await storage.get('x')).toEqual({ v: 1 });
    storage.reload();
    expect(await storage.get('x')).toEqual({ v: 2 });
  });
});
