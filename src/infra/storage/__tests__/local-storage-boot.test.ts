// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import { LocalStateRepository, STATE_KEY } from '../state-repository';

/**
 * N1/N2 regression tests for the cold-start hydration path.
 *
 * PersistentKeyValueStore hydrates its cache ASYNCHRONOUSLY at module load
 * (local-storage.ts). The real app must therefore gate its first state read
 * behind `persistentStoreReady` — otherwise the first store.get() caches an
 * EMPTY state forever (CachedStateStore loads once) and the user's progress
 * both vanishes from the UI and can be overwritten by the next save.
 *
 * These tests seed localStorage BEFORE importing the module, then drive the
 * exact boot sequence the app uses: await persistentStoreReady → reload → get.
 */

const seeded = { ...emptyAppState(), startDateISO: '2026-05-05', timeZone: 'Asia/Kolkata' };

/** Seeds localStorage, then imports a fresh module graph (new singletons). */
async function freshWithSeededStorage(rawValue: string) {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem('@levelup:' + STATE_KEY, rawValue);
  return await import('../local-storage');
}

describe('cold-start hydration (N1)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('persistentStoreReady resolves and the app-encoded (double-encoded) state survives', async () => {
    // This is exactly what the app writes: LocalStateRepository.save →
    // store.setItem(string) → persistentStorage.set → JSON.stringify(string).
    const mod = await freshWithSeededStorage(JSON.stringify(JSON.stringify(seeded)));
    await mod.persistentStoreReady;
    const repo = new LocalStateRepository(mod.persistentStore);
    expect(repo.load().startDateISO).toBe('2026-05-05');
    expect(repo.load().timeZone).toBe('Asia/Kolkata');
  });

  it('single-encoded v2 state in localStorage survives hydration (defensive stringify)', async () => {
    // Data written directly to localStorage (external tool, legacy write path,
    // manual restore) is single-encoded. Before the fix, init() cached the
    // JSON.parse result — an OBJECT — into Map<string,string>, and
    // LocalStateRepository.load() then JSON.parse(object) threw → a fresh
    // (empty) state. The user's data silently vanished on the next cold start.
    const mod = await freshWithSeededStorage(JSON.stringify(seeded));
    await mod.persistentStoreReady;
    const repo = new LocalStateRepository(mod.persistentStore);
    expect(repo.load().startDateISO).toBe('2026-05-05');
  });

  it('getItem never returns a non-string (cache stays Map<string,string>)', async () => {
    const mod = await freshWithSeededStorage(JSON.stringify(seeded));
    await mod.persistentStoreReady;
    expect(typeof mod.persistentStore.getItem(STATE_KEY)).toBe('string');
  });

  it('reloadPersistentStore() re-reads storage written by another source', async () => {
    const mod = await freshWithSeededStorage(JSON.stringify(JSON.stringify(seeded)));
    await mod.persistentStoreReady;
    const repo = new LocalStateRepository(mod.persistentStore);
    expect(repo.load().startDateISO).toBe('2026-05-05');
    // Another tab writes a different state directly to localStorage.
    const other = { ...emptyAppState(), startDateISO: '2026-08-08' };
    localStorage.setItem('@levelup:' + STATE_KEY, JSON.stringify(JSON.stringify(other)));
    await mod.reloadPersistentStore();
    expect(repo.load().startDateISO).toBe('2026-08-08');
  });

  it('container boot sequence surfaces persisted state (ready → reload → get)', async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('@levelup:' + STATE_KEY, JSON.stringify(JSON.stringify(seeded)));
    const [{ container }, lsMod] = await Promise.all([
      import('../../../di/container'),
      import('../local-storage'),
    ]);
    await lsMod.persistentStoreReady;
    container.store.reload();
    expect(container.store.get().startDateISO).toBe('2026-05-05');
    expect(container.store.get().timeZone).toBe('Asia/Kolkata');
  });
});
