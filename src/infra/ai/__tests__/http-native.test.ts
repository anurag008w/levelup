import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapacitorHttpClient } from '../http-native';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: (...args: unknown[]) => requestMock(...args) },
}));

describe('CapacitorHttpClient', () => {
  beforeEach(() => requestMock.mockReset());

  it('maps a successful JSON response', async () => {
    requestMock.mockResolvedValue({ status: 200, data: { ok: 1 }, headers: {}, url: 'u' });
    const client = new CapacitorHttpClient();
    const out = await client.requestJson({ url: 'https://x/models', method: 'GET' });
    expect(out).toEqual({ ok: 1 });
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x/models', method: 'GET' }));
  });

  it('parses a JSON string body when the native plugin returns raw text', async () => {
    requestMock.mockResolvedValue({ status: 200, data: '{"ok":1}', headers: {}, url: 'u' });
    const client = new CapacitorHttpClient();
    const out = await client.requestJson({ url: 'https://x/models', method: 'GET' });
    expect(out).toEqual({ ok: 1 });
  });

  it('keeps a non-JSON string body verbatim', async () => {
    requestMock.mockResolvedValue({ status: 200, data: 'plain text', headers: {}, url: 'u' });
    const client = new CapacitorHttpClient();
    const out = await client.requestJson({ url: 'https://x/models', method: 'GET' });
    expect(out).toBe('plain text');
  });

  it('throws HttpError with the extracted message for non-2xx', async () => {
    requestMock.mockResolvedValue({ status: 401, data: { error: { message: 'bad key' } }, headers: {}, url: 'u' });
    const client = new CapacitorHttpClient();
    await expect(client.requestJson({ url: 'https://x/chat', body: { a: 1 } })).rejects.toMatchObject({
      status: 401,
      kind: 'auth',
      message: 'bad key',
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('retries retryable statuses before giving up', async () => {
    requestMock
      .mockResolvedValueOnce({ status: 500, data: {}, headers: {}, url: 'u' })
      .mockResolvedValueOnce({ status: 200, data: 'ok', headers: {}, url: 'u' });
    const client = new CapacitorHttpClient();
    const out = await client.requestJson({ url: 'https://x/models', retries: 1 });
    expect(out).toBe('ok');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an aborted native JSON request', async () => {
    let resolveRequest!: (value: { status: number; data: string; headers: Record<string, string>; url: string }) => void;
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const controller = new AbortController();
    const client = new CapacitorHttpClient();
    const pending = client.requestJson({ url: 'https://x/chat', signal: controller.signal, retries: 3 });

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      status: 0,
      kind: 'aborted',
      message: 'Request aborted',
    });
    expect(requestMock).toHaveBeenCalledTimes(1);

    resolveRequest({ status: 200, data: '{}', headers: {}, url: 'u' });
  });

  it('feeds SSE frames from a full-body text response', async () => {
    requestMock.mockResolvedValue({
      status: 200,
      data: 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n',
      headers: {},
      url: 'u',
    });
    const frames: string[] = [];
    const client = new CapacitorHttpClient();
    await client.requestSse({ url: 'https://x/stream', body: {} }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles CRLF line endings from the server', async () => {
    requestMock.mockResolvedValue({
      status: 200,
      data: 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\ndata: [DONE]\r\n\r\n',
      headers: {},
      url: 'u',
    });
    const frames: string[] = [];
    const client = new CapacitorHttpClient();
    await client.requestSse({ url: 'https://x/stream', body: {} }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins a JSON payload wrapped across multiple data: lines', async () => {
    requestMock.mockResolvedValue({
      status: 200,
      data: 'data: {"a":\ndata: 1}\n\ndata: [DONE]\n\n',
      headers: {},
      url: 'u',
    });
    const frames: string[] = [];
    const client = new CapacitorHttpClient();
    await client.requestSse({ url: 'https://x/stream', body: {} }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}']);
  });

  it('rejects an in-flight native SSE request when the caller aborts', async () => {
    let resolveRequest!: (value: { status: number; data: string; headers: Record<string, string>; url: string }) => void;
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const controller = new AbortController();
    const client = new CapacitorHttpClient();
    const pending = client.requestSse({ url: 'https://x/stream', signal: controller.signal }, () => undefined);

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      status: 0,
      kind: 'aborted',
      message: 'Request aborted',
    });

    resolveRequest({ status: 200, data: '', headers: {}, url: 'u' });
  });

  it('does not start a native SSE request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const client = new CapacitorHttpClient();
    await expect(
      client.requestSse({ url: 'https://x/stream', signal: controller.signal }, () => undefined),
    ).rejects.toMatchObject({
      status: 0,
      kind: 'aborted',
      message: 'Request aborted',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });
});
