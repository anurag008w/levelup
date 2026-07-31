import { describe, expect, it } from 'vitest';
import { FetchHttpClient } from '../http';

function streamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('FetchHttpClient.requestSse', () => {
  it('parses LF-framed SSE events', async () => {
    const client = new FetchHttpClient(
      async () => streamResponse('data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n'),
      1000,
      0,
    );
    const frames: string[] = [];
    await client.requestSse({ url: 'https://x/s' }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('parses CRLF-framed SSE events (common with gateways/proxies)', async () => {
    const client = new FetchHttpClient(
      async () => streamResponse('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\ndata: [DONE]\r\n\r\n'),
      1000,
      0,
    );
    const frames: string[] = [];
    await client.requestSse({ url: 'https://x/s' }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('parses CRLF framing split across network chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":'));
        controller.enqueue(encoder.encode('1}\r\n\r\ndata'));
        controller.enqueue(encoder.encode(': {"b":2}\r\n\r\ndata: [DONE]'));
        controller.enqueue(encoder.encode('\r\n\r\n'));
        controller.close();
      },
    });
    const client = new FetchHttpClient(async () => new Response(stream, { status: 200 }), 1000, 0);
    const frames: string[] = [];
    await client.requestSse({ url: 'https://x/s' }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins a JSON payload wrapped across multiple data: lines', async () => {
    const client = new FetchHttpClient(
      async () => streamResponse('data: {"a":\ndata: 1}\n\ndata: [DONE]\n\n'),
      1000,
      0,
    );
    const frames: string[] = [];
    await client.requestSse({ url: 'https://x/s' }, (p) => frames.push(p));
    expect(frames).toEqual(['{"a":1}']);
  });
});
