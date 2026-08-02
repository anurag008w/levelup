import { describe, it, expect } from 'vitest';
import type { KeyValueRepository } from '../../../core/ports/repositories';
import type { ModelInfo } from '../../../core/domain/llm';
import { ModelCacheRepositoryImpl } from '../local-storage';

function memoryStore(): KeyValueRepository & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

const MODELS: ModelInfo[] = [
  {
    id: 'm1',
    name: 'M1',
    provider: 'openrouter',
    contextLength: 128000,
    modalities: { input: ['text'], output: ['text'] },
    supportsStreaming: true,
    supportsVision: false,
    supportsReasoning: true,
    supportsToolCalling: true,
    supportsStructuredOutputs: true,
    supportsThinking: null,
    pricing: null,
    isFree: false,
    deprecated: false,
    fetchedAt: 100,
  },
];

describe('ModelCacheRepositoryImpl', () => {
  it('returns null for an empty cache', () => {
    const repo = new ModelCacheRepositoryImpl(memoryStore());
    expect(repo.get('openrouter')).toBeNull();
  });

  it('round-trips models under the provider prefix', () => {
    const store = memoryStore();
    const repo = new ModelCacheRepositoryImpl(store);
    repo.set('openrouter', MODELS);
    expect(repo.get('openrouter')).toEqual(MODELS);
    // Providers are namespaced independently.
    expect(repo.get('gemini')).toBeNull();
  });

  it('clear replaces the value with an empty string', () => {
    const store = memoryStore();
    const repo = new ModelCacheRepositoryImpl(store);
    repo.set('openrouter', MODELS);
    repo.clear('openrouter');
    expect(store.data.get('ai-model-cache-v1:openrouter')).toBe('');
    expect(repo.get('openrouter')).toBeNull();
  });

  it('returns null for corrupt JSON instead of throwing', () => {
    const store = memoryStore();
    store.setItem('ai-model-cache-v1:openrouter', '[[[broken');
    expect(new ModelCacheRepositoryImpl(store).get('openrouter')).toBeNull();
  });

  it('returns null when the stored value is not an array', () => {
    const store = memoryStore();
    store.setItem('ai-model-cache-v1:openrouter', '{"id":"m1"}');
    expect(new ModelCacheRepositoryImpl(store).get('openrouter')).toBeNull();
  });
});
