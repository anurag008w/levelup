import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpRequestInit } from '../http';
import { OpenAICompatibleProvider } from '../openai-compatible';
import type { ProviderConfig } from '../../../core/domain/llm';

function fakeHttp(handler: (init: HttpRequestInit) => unknown): HttpClient {
  return {
    async requestJson<T>(init: HttpRequestInit): Promise<T> {
      return handler(init) as T;
    },
    async requestSse(): Promise<void> {
      return undefined;
    },
  };
}

const localConfig: ProviderConfig = {
  id: 'custom',
  label: 'Local Ollama',
  model: 'llama3',
  baseUrl: 'http://localhost:11434/v1',
  enabled: true,
};

describe('OpenAICompatibleProvider healthCheck', () => {
  it('checks a keyless localhost provider instead of reporting API key missing', async () => {
    let request: HttpRequestInit | null = null;
    const provider = new OpenAICompatibleProvider(
      localConfig,
      fakeHttp((init) => {
        request = init;
        return { data: [] };
      }),
      { defaultBaseUrl: 'https://example.invalid/v1' },
    );

    expect(provider.isConfigured()).toBe(true);
    const health = await provider.healthCheck();

    expect(health.ok).toBe(true);
    expect(health.message).toBeUndefined();
    expect(request?.url).toBe('http://localhost:11434/v1/models');
    expect(request?.headers?.Authorization).toBeUndefined();
  });

  it('still requires a key for remote providers', async () => {
    const remoteConfig: ProviderConfig = {
      ...localConfig,
      baseUrl: 'https://api.example.com/v1',
      apiKey: undefined,
    };
    const provider = new OpenAICompatibleProvider(
      remoteConfig,
      fakeHttp(() => ({ data: [] })),
      { defaultBaseUrl: 'https://example.invalid/v1' },
    );

    expect(provider.isConfigured()).toBe(false);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toBe('API key missing');
  });

  it('allows a configured remote provider to perform the normal health request', async () => {
    let request: HttpRequestInit | null = null;
    const provider = new OpenAICompatibleProvider(
      { ...localConfig, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' },
      fakeHttp((init) => {
        request = init;
        return { data: [] };
      }),
      { defaultBaseUrl: 'https://example.invalid/v1' },
    );

    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(request?.url).toBe('https://api.example.com/v1/models');
    expect(request?.headers?.Authorization).toBe('Bearer sk-test');
  });
});
