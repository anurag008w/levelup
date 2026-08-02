import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MODEL_CACHE_TTL_MS } from '../../../core/domain/llm';
import type { ModelInfo, ProviderConfig } from '../../../core/domain/llm';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { ModelCacheService } from '../model-cache.service';

function modelInfo(id: string, fetchedAt: number): ModelInfo {
  return {
    id,
    name: id,
    provider: 'openrouter',
    contextLength: null,
    modalities: { input: ['text'], output: ['text'] },
    supportsStreaming: null,
    supportsVision: null,
    supportsReasoning: null,
    supportsToolCalling: null,
    supportsStructuredOutputs: null,
    supportsThinking: null,
    pricing: null,
    isFree: false,
    deprecated: false,
    fetchedAt,
  };
}

type CacheState = { aiSettings: { modelCache: Record<string, ModelInfo[]> } };

function makeEnv(seed: Record<string, ModelInfo[]> = {}) {
  let state: CacheState = { aiSettings: { modelCache: seed } };
  const save = vi.fn(() => undefined);
  const provider = { fetchModels: vi.fn() };
  const factory = { create: () => provider } as unknown as ProviderFactory;
  const store = {
    get: () => state,
    save: (s: CacheState) => {
      state = s;
      save();
    },
  };
  return { cache: new ModelCacheService(factory, store, save), provider, save, getState: () => state };
}

const config: ProviderConfig = {
  id: 'openrouter',
  label: 'OpenRouter',
  apiKey: 'sk-test',
  model: 'a',
  baseUrl: 'https://api.test.com/v1',
  enabled: true,
};

describe('ModelCacheService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
  });

  it('fetches and caches models when nothing is cached', async () => {
    const { cache, provider, save } = makeEnv();
    provider.fetchModels.mockResolvedValue([modelInfo('m1', Date.now())]);
    const models = await cache.getModels(config);
    expect(models).toEqual([modelInfo('m1', Date.now())]);
    expect(provider.fetchModels).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('serves fresh in-memory cache without refetching', async () => {
    const { cache, provider } = makeEnv();
    provider.fetchModels.mockResolvedValue([modelInfo('m1', Date.now())]);
    await cache.getModels(config);
    await cache.getModels(config);
    expect(provider.fetchModels).toHaveBeenCalledTimes(1);
    expect(cache.getCached('openrouter')).toEqual([modelInfo('m1', Date.now())]);
  });

  it('serves fresh persisted cache without refetching', async () => {
    const fresh = [modelInfo('m1', Date.now())];
    const { cache, provider, save } = makeEnv({ openrouter: fresh });
    const models = await cache.getModels(config);
    expect(models).toEqual(fresh);
    expect(provider.fetchModels).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('refetches stale persisted cache', async () => {
    const stale = [modelInfo('m1', Date.now() - MODEL_CACHE_TTL_MS - 1000)];
    const { cache, provider } = makeEnv({ openrouter: stale });
    const fresh = [modelInfo('m1', Date.now())];
    provider.fetchModels.mockResolvedValue(fresh);
    const models = await cache.getModels(config);
    expect(models).toEqual(fresh);
    expect(provider.fetchModels).toHaveBeenCalledTimes(1);
  });

  it('refetches when the persisted cache is empty', async () => {
    const { cache, provider } = makeEnv({ openrouter: [] });
    provider.fetchModels.mockResolvedValue([modelInfo('m1', Date.now())]);
    const models = await cache.getModels(config);
    expect(models).toHaveLength(1);
    expect(provider.fetchModels).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh bypasses both memory and persisted caches', async () => {
    const { cache, provider } = makeEnv({ openrouter: [modelInfo('m1', Date.now())] });
    await cache.getModels(config); // warms memory cache
    provider.fetchModels.mockResolvedValue([modelInfo('m2', Date.now())]);
    const models = await cache.getModels(config, true);
    expect(models).toEqual([modelInfo('m2', Date.now())]);
    expect(provider.fetchModels).toHaveBeenCalledTimes(1);
  });

  it('persists fetched models into state for the next session', async () => {
    const { cache, provider, getState } = makeEnv();
    provider.fetchModels.mockResolvedValue([modelInfo('m1', Date.now())]);
    await cache.getModels(config);
    expect(getState().aiSettings.modelCache['openrouter']).toEqual([modelInfo('m1', Date.now())]);
  });

  it('getCached returns null for unknown providers', () => {
    const { cache } = makeEnv();
    expect(cache.getCached('nope')).toBeNull();
  });
});
