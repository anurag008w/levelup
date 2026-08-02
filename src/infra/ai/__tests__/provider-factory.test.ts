import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../../core/domain/llm';
import { ProviderFactory, providerLabel, OPENROUTER_BASE_URL, OPENCODE_BASE_URL } from '../provider-factory';
import { GeminiProvider } from '../gemini';
import { OpenAICompatibleProvider } from '../openai-compatible';

function config(id: ProviderConfig['id'], overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    label: providerLabel(id),
    baseUrl: '',
    apiKey: 'sk-test',
    model: 'm',
    enabled: true,
    ...overrides,
  };
}

describe('ProviderFactory', () => {
  it('creates a Gemini provider for gemini configs', () => {
    const factory = new ProviderFactory({} as never);
    expect(factory.create(config('gemini'))).toBeInstanceOf(GeminiProvider);
  });

  it('creates an OpenAI-compatible provider for openrouter with OpenRouter defaults', () => {
    const factory = new ProviderFactory({} as never);
    const provider = factory.create(config('openrouter'));
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('creates OpenAI-compatible providers for opencode, custom and unknown ids', () => {
    const factory = new ProviderFactory({} as never);
    expect(factory.create(config('opencode'))).toBeInstanceOf(OpenAICompatibleProvider);
    expect(factory.create(config('opencode-zen'))).toBeInstanceOf(OpenAICompatibleProvider);
    expect(factory.create(config('custom'))).toBeInstanceOf(OpenAICompatibleProvider);
    expect(factory.create(config('openai-compatible'))).toBeInstanceOf(OpenAICompatibleProvider);
  });
});

describe('providerLabel', () => {
  it('maps every provider id to a human label', () => {
    expect(providerLabel('openrouter')).toBe('OpenRouter');
    expect(providerLabel('gemini')).toBe('Gemini');
    expect(providerLabel('opencode')).toBe('OpenCode Zen');
    expect(providerLabel('opencode-zen')).toBe('OpenCode Zen');
    expect(providerLabel('openai-compatible')).toBe('Custom');
    expect(providerLabel('custom')).toBe('Custom');
  });
});

describe('provider base URLs', () => {
  it('exports the expected default endpoints', () => {
    expect(OPENROUTER_BASE_URL).toContain('openrouter.ai');
    expect(OPENCODE_BASE_URL).toContain('opencode.ai');
  });
});
