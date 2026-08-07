import { describe, it, expect, vi } from 'vitest';
import { WebSearchService, type WebSearchContext } from '../websearch.service';
import type { HttpClient } from '../http';

function jsonHttp(handler: (url: string, body: unknown) => Promise<unknown>): HttpClient {
  return {
    requestJson: vi.fn(async <T>(init: { url: string; body?: unknown }): Promise<T> => handler(init.url, init.body) as T),
    requestSse: vi.fn(),
  } as unknown as HttpClient;
}

const googleCtx: WebSearchContext = {
  providerId: 'google',
  apiKey: 'AIza-test',
  baseUrl: '',
  model: 'gemini-2.5-flash',
};

const smartrotatorCtx: WebSearchContext = {
  providerId: 'smartrotator',
  apiKey: 'sk-test',
  baseUrl: 'https://smartrotator.onrender.com/v1',
};

const messages = [{ role: 'user' as const, content: 'kab aaye results?' }];

describe('WebSearchService', () => {
  it('calls Gemini generateContent with google_search grounding and parses grounded text + sources', async () => {
    const http = jsonHttp((url, body) => {
      expect(url).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
      expect((body as { tools?: unknown }).tools).toEqual([{ google_search: {} }]);
      return {
        candidates: [{ content: { parts: [{ text: 'NEET 2026 results 15 June ko aaye.' }] } }],
        groundingMetadata: {
          groundingChunks: [
            { web: { title: 'NTA NEET 2026', uri: 'https://nta.ac.in', snippet: 'Results declared.' } },
          ],
        },
      };
    });
    const svc = new WebSearchService(http);
    const res = await svc.search(googleCtx, messages);
    expect(res.ok).toBe(true);
    expect(res.text).toContain('NEET 2026 results 15 June ko aaye.');
    expect(res.text).toContain('Sources:');
  });

  it('returns ok:false when the Gemini response has no grounded text or chunks', async () => {
    const http = jsonHttp(async () => ({ candidates: [] }));
    const svc = new WebSearchService(http);
    const res = await svc.search(googleCtx, messages);
    expect(res.ok).toBe(false);
  });

  it('calls SmartRotator /chat/completions with the web_search tool', async () => {
    const http = jsonHttp((url, body) => {
      expect(url).toBe('https://smartrotator.onrender.com/v1/chat/completions');
      const b = body as { tools?: unknown; messages?: unknown[] };
      expect(b.tools).toEqual([{ type: 'web_search' }]);
      expect((b.messages as Array<{ role: string }>)[0].role).toBe('system');
      return { choices: [{ message: { content: 'Results 15 June ko aaye.' } }] };
    });
    const svc = new WebSearchService(http);
    const res = await svc.search(smartrotatorCtx, messages);
    expect(res.ok).toBe(true);
    expect(res.text).toContain('15 June');
  });

  it('returns ok:false when the SmartRotator answer is empty', async () => {
    const http = jsonHttp(async () => ({ choices: [{ message: { content: '' } }] }));
    const svc = new WebSearchService(http);
    const res = await svc.search(smartrotatorCtx, messages);
    expect(res.ok).toBe(false);
  });

  it('never throws on a backend error — returns ok:false instead', async () => {
    const http = jsonHttp(async () => {
      throw new Error('400 bad request');
    });
    const svc = new WebSearchService(http);
    const res = await svc.search(smartrotatorCtx, messages);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('400 bad request');
  });

  it('returns ok:false without a call when no API key is present', async () => {
    const http = jsonHttp(async () => {
      throw new Error('should not be called');
    });
    const svc = new WebSearchService(http);
    const res = await svc.search({ ...googleCtx, apiKey: '' }, messages);
    expect(res.ok).toBe(false);
  });
});
