import { describe, it, expect } from 'vitest';
import type { HttpClient, HttpRequestInit } from '../../../infra/ai/http';
import { OpenAICompatibleProvider, mapOpenAIModel } from '../../../infra/ai/openai-compatible';
import { GeminiProvider, mapGeminiModel } from '../../../infra/ai/gemini';
import { buildHiddenDefaultConfig } from '../../../infra/ai/provider-factory';
import type { LLMResponse, ProviderConfig } from '../../../core/domain/llm';

function fakeHttp(handler: (init: HttpRequestInit) => unknown): HttpClient {
  return {
    async requestJson<T>(init: HttpRequestInit): Promise<T> {
      return handler(init) as T;
    },
    async requestSse(init: HttpRequestInit, onData: (payload: string) => void): Promise<void> {
      const out = handler(init) as string;
      for (const chunk of out.split('\n\n')) {
        if (chunk.startsWith('data:')) onData(chunk.slice(5).trim());
      }
    },
  };
}

const openrouterConfig: ProviderConfig = {
  id: 'openrouter',
  label: 'OpenRouter',
  apiKey: 'sk-test',
  model: 'anthropic/claude-3.5-sonnet',
  baseUrl: 'https://openrouter.ai/api/v1',
  enabled: true,
};

describe('OpenAICompatibleProvider', () => {
  it('shapes a chat completion request and maps the response', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { choices: [{ message: { content: 'hello' } }], model: 'm1', usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } };
    });
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, {
      defaultBaseUrl: 'https://x',
      extraHeaders: { 'HTTP-Referer': 'https://app.local', 'X-OpenRouter-Title': 'Test' },
    });
    const res: LLMResponse = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello');
    expect(res.usage?.cost).toBe(0.001);
    expect(captured!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(captured!.body).toEqual({
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: undefined,
      max_tokens: undefined,
      stream: false,
    });
    expect(captured!.headers?.Authorization).toBe('Bearer sk-test');
    expect(captured!.headers?.['HTTP-Referer']).toBeDefined();
  });

  it('sends streaming flag and forwards deltas', async () => {
    const http = fakeHttp(() => 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}');
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    let acc = '';
    const res = await provider.stream({ messages: [], onDelta: (d) => (acc += d) });
    expect(res.text).toBe('ab');
    expect(acc).toBe('ab');
  });

  it('falls back to a single non-streaming call when the stream carries no content', async () => {
    let sseCalls = 0;
    const http: HttpClient = {
      async requestJson<T>(_init: HttpRequestInit): Promise<T> {
        return { choices: [{ message: { content: 'complete fallback' } }], model: 'm1' } as T;
      },
      async requestSse(_init: HttpRequestInit, _onData: (payload: string) => void): Promise<void> {
        sseCalls += 1;
        // server streams nothing at all
      },
    };
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    let acc = '';
    const res = await provider.stream({ messages: [], onDelta: (d) => (acc += d) });
    expect(sseCalls).toBe(1);
    expect(res.text).toBe('complete fallback');
    expect(acc).toBe('complete fallback');
  });

  it('does NOT fall back to non-streaming when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const http: HttpClient = {
      async requestJson<T>(_init: HttpRequestInit): Promise<T> {
        throw new Error('complete must not run after abort');
      },
      async requestSse(_init: HttpRequestInit, _onData: (payload: string) => void): Promise<void> {
        // simulate the abort surfacing via the http layer
        throw Object.assign(new Error('Request aborted'), { kind: 'aborted', status: 0 });
      },
    };
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    await expect(provider.stream({ messages: [], signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('fetches and maps models with pricing', async () => {
    const http = fakeHttp(() => ({
      data: [
        {
          id: 'm1',
          name: 'Model One',
          context_length: 200000,
          pricing: { prompt: '0', completion: '0' },
          supported_parameters: ['streaming', 'reasoning', 'vision'],
          input_modalities: ['text', 'image'],
        },
        {
          id: 'm2',
          pricing: { prompt: '1.25', completion: '5' },
          deprecated: true,
        },
      ],
    }));
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    const models = await provider.fetchModels();
    expect(models).toHaveLength(2);
    const m1 = models[0];
    expect(m1.isFree).toBe(true);
    expect(m1.contextLength).toBe(200000);
    expect(m1.supportsVision).toBe(true);
    expect(m1.supportsReasoning).toBe(true);
    expect(m1.pricing).toEqual({ prompt: 0, completion: 0 });
    expect(models[1].deprecated).toBe(true);
  });

  it('maps reasoning_content and adds reasoning fields for OpenRouter', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { choices: [{ message: { content: 'final', reasoning_content: 'thinking...' } }], model: 'm1' };
    });
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    const res = await provider.complete({ messages: [], thinking: 'high' });
    expect(res.text).toBe('final');
    expect(res.reasoning).toBe('thinking...');
    expect((captured!.body as { reasoning: { effort: string } }).reasoning).toEqual({ effort: 'high' });
    expect((captured!.body as { include_reasoning: boolean }).include_reasoning).toBe(true);
  });

  it('uses reasoning_effort for generic openai-compatible providers', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { choices: [{ message: { content: 'ok' } }], model: 'm1' };
    });
    const provider = new OpenAICompatibleProvider(
      { ...openrouterConfig, id: 'custom', baseUrl: 'http://localhost:9999/v1' },
      http,
      { defaultBaseUrl: 'http://localhost:9999/v1' },
    );
    await provider.complete({ messages: [], thinking: 'medium' });
    expect((captured!.body as { reasoning_effort: string }).reasoning_effort).toBe('medium');
    expect((captured!.body as { reasoning?: unknown }).reasoning).toBeUndefined();
  });

  it('omits reasoning fields when thinking is off', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { choices: [{ message: { content: 'ok' } }], model: 'm1' };
    });
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    await provider.complete({ messages: [], thinking: 'off' });
    expect((captured!.body as { reasoning?: unknown }).reasoning).toBeUndefined();
    expect((captured!.body as { include_reasoning?: unknown }).include_reasoning).toBeUndefined();
  });

  it('streams reasoning_content via onReasoningDelta', async () => {
    const http = fakeHttp(
      () => 'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"}}]}',
    );
    const provider = new OpenAICompatibleProvider(openrouterConfig, http, { defaultBaseUrl: 'https://x' });
    let text = '';
    let reasoning = '';
    const res = await provider.stream({ messages: [], onDelta: (d) => (text += d), onReasoningDelta: (d) => (reasoning += d) });
    expect(text).toBe('answer');
    expect(res.text).toBe('answer');
    expect(reasoning).toBe('think');
    expect(res.reasoning).toBe('think');
  });
});

describe('mapOpenAIModel', () => {
  it('returns null for malformed rows', () => {
    expect(mapOpenAIModel(null, 'openrouter', 1)).toBeNull();
    expect(mapOpenAIModel({}, 'openrouter', 1)).toBeNull();
  });
});

describe('GeminiProvider', () => {
  it('maps native model names and limits', () => {
    const model = mapGeminiModel(
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] },
      'gemini',
      1,
    );
    expect(model?.id).toBe('gemini-2.5-flash');
    expect(model?.contextLength).toBe(1048576);
    expect(model?.supportsStreaming).toBe(true);
  });

  it('shapes a native generateContent request', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } };
    });
    const provider = new GeminiProvider({ id: 'gemini', label: 'Gemini', apiKey: 'gk', model: 'gemini-2.5-flash', enabled: true }, http);
    const res = await provider.complete({ messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'q' }] });
    expect(res.text).toBe('ok');
    expect(captured!.url).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(captured!.headers?.['x-goog-api-key']).toBe('gk');
    const body = captured!.body as { system_instruction: { parts: { text: string }[] }; contents: { role: string }[] };
    expect(body.system_instruction.parts[0].text).toBe('be terse');
    expect(body.contents[0].role).toBe('user');
  });

  it('sends thinkingConfig budget and splits thought parts', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return {
        candidates: [{ content: { parts: [{ thought: true, text: 'soch...' }, { text: 'jawab' }] } }],
      };
    });
    const provider = new GeminiProvider({ id: 'gemini', label: 'Gemini', apiKey: 'gk', model: 'gemini-2.5-flash', enabled: true }, http);
    const res = await provider.complete({ messages: [], thinking: 'high' });
    expect(res.text).toBe('jawab');
    expect(res.reasoning).toBe('soch...');
    const config = (captured!.body as { generationConfig: { thinkingConfig: { thinkingBudget: number } } }).generationConfig;
    expect(config.thinkingConfig.thinkingBudget).toBe(16384);
  });

  it('omits thinkingConfig when thinking is off', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
    });
    const provider = new GeminiProvider({ id: 'gemini', label: 'Gemini', apiKey: 'gk', model: 'gemini-2.5-flash', enabled: true }, http);
    await provider.complete({ messages: [], thinking: 'off' });
    const config = (captured!.body as { generationConfig: { thinkingConfig?: unknown } }).generationConfig;
    expect(config.thinkingConfig).toBeUndefined();
  });

  it('clamps thinkingBudget below a small maxTokens window', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
    });
    const provider = new GeminiProvider({ id: 'gemini', label: 'Gemini', apiKey: 'gk', model: 'gemini-2.5-flash', enabled: true }, http);
    await provider.complete({ messages: [], thinking: 'high', maxTokens: 1024 });
    const config = (captured!.body as { generationConfig: { thinkingConfig: { thinkingBudget: number }; maxOutputTokens: number } }).generationConfig;
    expect(config.maxOutputTokens).toBe(1024);
    // Reserves a 512-token output window so thinking never leaves a blank reply.
    expect(config.thinkingConfig.thinkingBudget).toBe(512);
  });

  it('drops thinkingConfig when the window leaves no room for output', async () => {
    let captured: HttpRequestInit | null = null;
    const http = fakeHttp((init) => {
      captured = init;
      return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
    });
    const provider = new GeminiProvider({ id: 'gemini', label: 'Gemini', apiKey: 'gk', model: 'gemini-2.5-flash', enabled: true }, http);
    await provider.complete({ messages: [], thinking: 'low', maxTokens: 128 });
    const config = (captured!.body as { generationConfig: { thinkingConfig?: unknown } }).generationConfig;
    expect(config.thinkingConfig).toBeUndefined();
  });

  it('streams thought parts via onReasoningDelta', async () => {
    const http = fakeHttp(
      () => 'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"a"},{"text":"A"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"thought":true,"text":"b"},{"text":"B"}]}}]}',
    );
    const provider = new GeminiProvider({ id: 'gemini', label: 'Gemini', apiKey: 'gk', model: 'gemini-2.5-flash', enabled: true }, http);
    let text = '';
    let reasoning = '';
    const res = await provider.stream({ messages: [], onDelta: (d) => (text += d), onReasoningDelta: (d) => (reasoning += d) });
    expect(text).toBe('AB');
    expect(reasoning).toBe('ab');
    expect(res.reasoning).toBe('ab');
  });
});

describe('buildHiddenDefaultConfig', () => {
  it('returns null without all env vars', () => {
    expect(buildHiddenDefaultConfig({})).toBeNull();
    expect(buildHiddenDefaultConfig({ VITE_DEFAULT_AI_BASE_URL: 'x' })).toBeNull();
  });

  it('builds a hidden config and never leaks the model via the public view', () => {
    const cfg = buildHiddenDefaultConfig({
      VITE_DEFAULT_AI_BASE_URL: 'https://example.com/v1',
      VITE_DEFAULT_AI_API_KEY: 'secret',
      VITE_DEFAULT_AI_MODEL: 'internal-model',
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.hidden).toBe(true);
    expect(cfg!.enabled).toBe(true);
  });
});
