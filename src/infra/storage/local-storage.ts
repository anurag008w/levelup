import type { KeyValueRepository, ModelCacheRepository } from '../../core/ports/repositories';
import type { ModelInfo } from '../../core/domain/llm';

export class BrowserStorage implements KeyValueRepository {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage full / unavailable — the app keeps working in-memory.
    }
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
