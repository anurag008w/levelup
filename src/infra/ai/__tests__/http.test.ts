import { describe, expect, it } from 'vitest';
import { FetchHttpClient, HttpError } from '../http';

describe('FetchHttpClient', () => {
  it('binds fetch so detached calls never throw Illegal invocation', async () => {
    const seenThis: unknown[] = [];
    const plainFetch = function (this: unknown, _input: string, _init?: RequestInit) {
      seenThis.push(this);
      return Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    } as unknown as typeof fetch;

    const client = new FetchHttpClient(plainFetch);
    const out = await client.requestJson<{ ok: number }>({ url: 'https://x/models', method: 'GET' });
    expect(out).toEqual({ ok: 1 });
    expect(seenThis[0]).toBe(globalThis);
  });

  it('throws HttpError with detail for fetch rejection', async () => {
    const failingFetch = function (this: unknown) {
      void this;
      return Promise.reject(new TypeError('Failed to fetch'));
    } as unknown as typeof fetch;
    const client = new FetchHttpClient(failingFetch, 5000, 0);
    await expect(client.requestJson({ url: 'https://x' })).rejects.toMatchObject({
      kind: 'network',
      status: 0,
    });
  });

  it('extracts provider error message from a non-2xx JSON body', async () => {
    const errFetch = function (this: unknown, _input: string, _init?: RequestInit) {
      void this;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }),
      );
    } as unknown as typeof fetch;
    const client = new FetchHttpClient(errFetch, 5000, 0);
    await expect(client.requestJson({ url: 'https://x/chat', body: {} })).rejects.toMatchObject({
      status: 401,
      kind: 'auth',
      message: 'invalid api key',
    });
  });

  it('retries retryable statuses before surfacing the error', async () => {
    let calls = 0;
    const flakyFetch = function (this: unknown, _input: string, _init?: RequestInit) {
      void this;
      calls++;
      return Promise.resolve(
        calls === 1 ? new Response('', { status: 503 }) : new Response('"ok"', { status: 200 }),
      );
    } as unknown as typeof fetch;
    const client = new FetchHttpClient(flakyFetch, 5000, 1);
    const out = await client.requestJson<string>({ url: 'https://x' });
    expect(out).toBe('ok');
    expect(calls).toBe(2);
  });

  it('maps status codes to HttpError kinds', async () => {
    const statusFetch = function (this: unknown, _input: string, _init?: RequestInit) {
      void this;
      return Promise.resolve(new Response('', { status: 429 }));
    } as unknown as typeof fetch;
    const client = new FetchHttpClient(statusFetch, 5000, 0);
    await expect(client.requestJson({ url: 'https://x' })).rejects.toBeInstanceOf(HttpError);
    await expect(client.requestJson({ url: 'https://x' })).rejects.toMatchObject({ kind: 'rate-limit' });
  });
});
