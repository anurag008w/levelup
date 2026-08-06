import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible';
import { GeminiProvider } from '../gemini';
import { HttpError } from '../http';
import type { ProviderConfig } from '../../../core/domain/llm';
import type { HttpClient, HttpRequestInit } from '../http';
import type { LLMRequest } from '../../../core/domain/llm';

/**
 * Fake HttpClient that records every request body and lets tests queue
 * responses (or errors) per call. Values that are `Error` instances are
 * thrown; everything else is returned as the JSON response.
 */
function fakeHttp(queue: unknown[]): HttpClient & { bodies: Record<string, unknown>[] } {
  let call = 0;
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    async requestJson<T>(init: HttpRequestInit): Promise<T> {
      bodies.push((init.body ?? {}) as Record<string, unknown>);
      const value = queue[call++] ?? queue[queue.length - 1];
      if (value instanceof Error) throw value;
      return value as T;
    },
    async requestSse(init: HttpRequestInit, onData: (payload: string) => void): Promise<void> {
      bodies.push((init.body ?? {}) as Record<string, unknown>);
      const value = queue[call++] ?? queue[queue.length - 1];
      if (value instanceof Error) throw value;
      for (const payload of value as string[]) onData(payload);
    },
  };
}

function cfg(id: ProviderConfig['id'], baseUrl = 'https://api.example.com/v1'): ProviderConfig {
  return { id, label: id, baseUrl, apiKey: 'sk-test', model: 'm', enabled: true };
}

function baseRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return { messages: [{ role: 'user', content: 'hello' }], providerId: 'gemini', ...overrides };
}

/** Minimal Gemini generateContent response body. */
function geminiResponse(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/** Minimal OpenAI chat completion response body. */
function openaiResponse(text: string) {
  return { choices: [{ message: { role: 'assistant', content: text } }] };
}

function geminiHttpError(): HttpError {
  return new HttpError('400 invalid argument: google_search is not supported for this model', 400, 'bad-request', null);
}

function openaiHttpError(): HttpError {
  return new HttpError("Unknown type: 'web_search' is not supported for this model", 400, 'bad-request', null);
}

describe('GeminiProvider websearch', () => {
  it('adds google_search grounding when websearch is enabled', async () => {
    const http = fakeHttp([geminiResponse('grounded answer')]);
    const provider = new GeminiProvider(cfg('gemini', ''), http);
    await provider.complete(baseRequest({ websearch: true }));
    const body = http.bodies[0];
    expect(body.tools).toEqual([{ google_search: {} }]);
  });

  it('omits tools when websearch is disabled', async () => {
    const http = fakeHttp([geminiResponse('plain answer')]);
    const provider = new GeminiProvider(cfg('gemini', ''), http);
    await provider.complete(baseRequest());
    expect(http.bodies[0].tools).toBeUndefined();
  });

  it('retries once without the tool when the model rejects grounding', async () => {
    const http = fakeHttp([geminiHttpError(), geminiResponse('fallback answer')]);
    const provider = new GeminiProvider(cfg('gemini', ''), http);
    const res = await provider.complete(baseRequest({ websearch: true }));
    expect(res.text).toBe('fallback answer');
    expect(http.bodies).toHaveLength(2);
    expect(http.bodies[0].tools).toEqual([{ google_search: {} }]);
    expect(http.bodies[1].tools).toBeUndefined();
  });

  it('streams grounded chunks with the tool attached', async () => {
    const http = fakeHttp([[JSON.stringify(geminiResponse('hello ')), JSON.stringify(geminiResponse('world'))]]);
    const provider = new GeminiProvider(cfg('gemini', ''), http);
    const deltas: string[] = [];
    const res = await provider.stream(baseRequest({ websearch: true, onDelta: (d) => deltas.push(d) }));
    expect(http.bodies[0].tools).toEqual([{ google_search: {} }]);
    expect(res.text).toBe('hello world');
    expect(deltas.join('')).toBe('hello world');
  });
});

describe('OpenAICompatibleProvider websearch', () => {
  it('adds the native web_search tool when websearch is enabled', async () => {
    const http = fakeHttp([openaiResponse('grounded answer')]);
    const provider = new OpenAICompatibleProvider(cfg('custom'), http, { defaultBaseUrl: 'https://api.example.com/v1' });
    await provider.complete(baseRequest({ websearch: true }));
    expect(http.bodies[0].tools).toEqual([{ type: 'web_search' }]);
  });

  it('omits tools when websearch is disabled', async () => {
    const http = fakeHttp([openaiResponse('plain answer')]);
    const provider = new OpenAICompatibleProvider(cfg('custom'), http, { defaultBaseUrl: 'https://api.example.com/v1' });
    await provider.complete(baseRequest());
    expect(http.bodies[0].tools).toBeUndefined();
  });

  it('retries once without the tool when the endpoint rejects web_search (e.g. Groq Gemma)', async () => {
    const http = fakeHttp([openaiHttpError(), openaiResponse('fallback answer')]);
    const provider = new OpenAICompatibleProvider(cfg('custom'), http, { defaultBaseUrl: 'https://api.example.com/v1' });
    const res = await provider.complete(baseRequest({ websearch: true }));
    expect(res.text).toBe('fallback answer');
    expect(http.bodies).toHaveLength(2);
    expect(http.bodies[0].tools).toEqual([{ type: 'web_search' }]);
    expect(http.bodies[1].tools).toBeUndefined();
  });

  it('streams with the web_search tool attached', async () => {
    const http = fakeHttp([
      [JSON.stringify({ choices: [{ delta: { content: 'hi ' } }] }), JSON.stringify({ choices: [{ delta: { content: 'there' } }] })],
    ]);
    const provider = new OpenAICompatibleProvider(cfg('custom'), http, { defaultBaseUrl: 'https://api.example.com/v1' });
    const deltas: string[] = [];
    const res = await provider.stream(baseRequest({ websearch: true, onDelta: (d) => deltas.push(d) }));
    expect(http.bodies[0].tools).toEqual([{ type: 'web_search' }]);
    expect(res.text).toBe('hi there');
    expect(deltas.join('')).toBe('hi there');
  });

  it('retries the stream once when the endpoint rejects the web_search tool', async () => {
    const http = fakeHttp([openaiHttpError(), [JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })]]);
    const provider = new OpenAICompatibleProvider(cfg('custom'), http, { defaultBaseUrl: 'https://api.example.com/v1' });
    const res = await provider.stream(baseRequest({ websearch: true }));
    expect(res.text).toBe('ok');
    expect(http.bodies).toHaveLength(2);
    expect(http.bodies[1].tools).toBeUndefined();
  });

  it('does not retry (and surfaces the error) for non-tool failures', async () => {
    const http = fakeHttp([new HttpError('429 rate limited', 429, 'rate-limit', null)]);
    const provider = new OpenAICompatibleProvider(cfg('custom'), http, { defaultBaseUrl: 'https://api.example.com/v1' });
    await expect(provider.complete(baseRequest({ websearch: true }))).rejects.toThrow(/rate limited/i);
    expect(http.bodies).toHaveLength(1);
  });
});
