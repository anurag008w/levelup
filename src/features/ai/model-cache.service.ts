import type { LLMProvider, ModelInfo, ProviderConfig } from '../../core/domain/llm';
import { MODEL_CACHE_TTL_MS } from '../../core/domain/llm';
import type { ProviderFactory } from '../../infra/ai/provider-factory';

/** Fetches and caches model catalogs per provider (in-memory + persisted). */
export class ModelCacheService {
  private readonly memory: Map<string, ModelInfo[]> = new Map();
  private readonly factory: ProviderFactory;
  private readonly state: { get: () => { aiSettings: { modelCache: Record<string, ModelInfo[]> } } };
  private readonly saveState: () => void;

  constructor(
    factory: ProviderFactory,
    state: { get: () => { aiSettings: { modelCache: Record<string, ModelInfo[]> } } },
    saveState: () => void,
  ) {
    this.factory = factory;
    this.state = state;
    this.saveState = saveState;
  }

  /** Returns models from cache if fresh, otherwise fetches and caches. */
  async getModels(config: ProviderConfig, forceRefresh = false): Promise<ModelInfo[]> {
    const cached = this.memory.get(config.id);
    if (!forceRefresh && cached) return cached;

    const persisted = this.state.get().aiSettings.modelCache[config.id];
    if (!forceRefresh && persisted && isFresh(persisted)) {
      this.memory.set(config.id, persisted);
      return persisted;
    }

    const provider: LLMProvider = this.factory.create(config);
    const models = await provider.fetchModels();

    this.memory.set(config.id, models);
    const state = this.state.get();
    state.aiSettings.modelCache[config.id] = models;
    this.saveState();
    return models;
  }

  getCached(configId: string): ModelInfo[] | null {
    return this.memory.get(configId) ?? null;
  }
}

function isFresh(models: ModelInfo[]): boolean {
  if (models.length === 0) return false;
  return Date.now() - models[0].fetchedAt < MODEL_CACHE_TTL_MS;
}
