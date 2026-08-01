import type { KeyValueRepository, ModelCacheRepository } from '../../core/ports/repositories';
import type { ModelInfo } from '../../core/domain/llm';
import persistentStorage from './persistent-storage';

// Sync wrapper for KeyValueRepository interface
class PersistentKeyValueStore implements KeyValueRepository {
  private cache: Map<string, string> = new Map();
  private initialized = false;

  async init() {
    if (this.initialized) return;
    const keys = await persistentStorage.keys();
    for (const key of keys) {
      const value = await persistentStorage.get<string>(key);
      if (value !== null) {
        this.cache.set(key, value);
      }
    }
    this.initialized = true;
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache.set(key, value);
    // Save async but don't wait
    persistentStorage.set(key, value).catch(console.error);
  }
}

export const persistentStore = new PersistentKeyValueStore();

// Initialize on load
if (typeof window !== 'undefined') {
  persistentStore.init();
}

export class BrowserStorage implements KeyValueRepository {
  private asyncStore: PersistentKeyValueStore = persistentStore;

  getItem(key: string): string | null {
    return this.asyncStore.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.asyncStore.setItem(key, value);
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
