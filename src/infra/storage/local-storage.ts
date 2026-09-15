import type { KeyValueRepository, ModelCacheRepository } from '../../core/ports/repositories';
import type { ModelInfo } from '../../core/domain/llm';
import persistentStorage from './persistent-storage';

// Sync wrapper for KeyValueRepository interface
class PersistentKeyValueStore implements KeyValueRepository {
  private cache: Map<string, string> = new Map();
  private initialized = false;

  async init() {
    if (this.initialized) return;
    await this.reload();
    this.initialized = true;
  }

  /**
   * Re-reads storage into the cache. Also used at boot (via reloadPersistentStore)
   * and on visibilitychange → visible so another tab's writes become visible.
   *
   * Build a fresh map first, then swap it atomically. Clearing the live cache
   * before awaiting persistent reads creates a window where getItem() returns
   * null; a concurrent setItem() can then be overwritten by a stale value from
   * the still-running reload loop.
   */
  async reload() {
    const next = new Map<string, string>();
    const keys = await persistentStorage.keys();
    for (const key of keys) {
      const value = await persistentStorage.get<string>(key);
      if (value !== null) {
        next.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }
    this.cache = next;
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache.set(key, value);
    // Save async but don't wait
    persistentStorage.set(key, value).catch(console.error);
  }

  /** AUDIT FIX (round 1): surface underlying write failures (quota etc.).
   *  The wrapper fire-and-forgets the persist; without this passthrough the
   *  caller can never tell a disk write failed and data would silently be
   *  lost on the next app restart. */
  getLastWriteError(): string | null {
    return persistentStorage.getLastWriteError();
  }
}

export const persistentStore = new PersistentKeyValueStore();

const initPromise = typeof window !== 'undefined' ? persistentStore.init() : Promise.resolve();
/**
 * Resolves once the persistent cache is hydrated from localStorage. The app
 * boot sequence MUST await this before the first store read (see main.tsx):
 * without it the first store.get() can cache an EMPTY state forever
 * (CachedStateStore loads once) and a subsequent save overwrites real data.
 * Never rejects — worst case the app boots with an empty cache.
 */
export const persistentStoreReady: Promise<void> = initPromise.catch(() => {
  console.error('[storage] persistent store init failed — booting with an empty cache');
});

/**
 * Re-reads the whole storage chain (persistentStorage → PersistentKeyValueStore)
 * so the state/chat repositories see data written by another tab or process.
 */
export async function reloadPersistentStore(): Promise<void> {
  await persistentStorage.reload();
  await persistentStore.reload();
}

export class BrowserStorage implements KeyValueRepository {
  private asyncStore: PersistentKeyValueStore = persistentStore;

  getItem(key: string): string | null {
    return this.asyncStore.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.asyncStore.setItem(key, value);
  }

  getLastWriteError(): string | null {
    return this.asyncStore.getLastWriteError();
  }
}

const MODEL_CACHE_PREFIX = 'ai-model-cache-v1:';

export class ModelCacheRepositoryImpl implements ModelCacheRepository {
  private readonly store: KeyValueRepository;

  constructor(store: KeyValueRepository) {
    this.store = store;
  }

  get(providerId: string): ModelInfo[] | null {
    const raw = this.store.getItem(MODEL_CACHE_PREFIX + providerId);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ModelInfo[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  set(providerId: string, models: ModelInfo[]): void {
    this.store.setItem(MODEL_CACHE_PREFIX + providerId, JSON.stringify(models));
  }

  clear(providerId: string): void {
    this.store.setItem(MODEL_CACHE_PREFIX + providerId, '');
  }
}
