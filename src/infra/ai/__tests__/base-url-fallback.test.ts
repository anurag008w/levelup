import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible';
import { GeminiProvider } from '../gemini';
import { ProviderError } from '../../../core/domain/llm';
import type { ProviderConfig } from '../../../core/domain/llm';
import type { HttpClient, HttpRequestInit } from '../http';

function fakeHttp(urls: string[]): HttpClient {
  return {
    async requestJson<T>(init: HttpRequestInit): Promise<T> {
      urls.push(init.url);
      return { data: [] } as T;
    },
    async requestSse(): Promise<void> {},
  };
}

function cfg(id: ProviderConfig['id'], baseUrl?: string): ProviderConfig {
  return { id, label: id, baseUrl, apiKey: 'sk-test', model: 'm', enabled: true };
}

describe('provider base URL fallback', () => {
  it('treats an empty-string base URL as unset for openai-compatible providers', async () => {
    const urls: string[] = [];
    const provider = new OpenAICompatibleProvider(cfg('openrouter', ''), fakeHttp(urls), {
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
    });
    await provider.fetchModels();
    expect(urls[0]).toBe('https://openrouter.ai/api/v1/models');
  });

  it('falls back to the Gemini default when the stored base URL is an empty string', async () => {
    const urls: string[] = [];
    const provider = new GeminiProvider(cfg('gemini', ''), fakeHttp(urls));
    await provider.fetchModels();
    expect(urls[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200');
  });

  it('throws a clear error when a custom provider has no usable base URL', async () => {
    const provider = new OpenAICompatibleProvider(cfg('custom'), fakeHttp([]), { defaultBaseUrl: '' });
    await expect(provider.fetchModels()).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.fetchModels()).rejects.toThrow(/base URL/i);
  });
});
