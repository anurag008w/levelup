import { CapacitorHttp, type HttpOptions } from '@capacitor/core';
import { delayMs, extractErrorMessage, HttpError, type HttpClient, type HttpRequestInit } from './http';

/**
 * True when running inside the native Capacitor app (Android/iOS), where
 * requests go through the native stack (OkHttp) and are NOT subject to
 * browser CORS. This is what makes browser-blocked providers (OpenCode Zen)
 * work on mobile.
 */
export function isNativePlatform(): boolean {
  const w = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  return typeof w.Capacitor?.isNativePlatform === 'function' && w.Capacitor.isNativePlatform();
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Race a native request against the caller's abort signal. CapacitorHttp does
 * not currently expose an AbortSignal cancellation hook, so this only makes
 * the app-facing promise cancel promptly; the native request itself still
 * relies on its connect/read timeout. Listener cleanup prevents long-lived
 * abort signals from accumulating one handler per request.
 */
function requestWithAbort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation();
  if (signal.aborted) return Promise.reject(new HttpError('Request aborted', 0, 'aborted', null));

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(new HttpError('Request aborted', 0, 'aborted', null));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (err) {
      cleanup();
      reject(err);
      return;
    }

    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
}

/**
 * HttpClient backed by the Capacitor native HTTP plugin. On web it falls back
 * to the native plugin's own fetch implementation (same CORS rules apply); the
 * DI container only uses this client on real devices.
 */
export class CapacitorHttpClient implements HttpClient {
  async requestJson<T>(init: HttpRequestInit): Promise<T> {
    const retries = init.retries ?? 3;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // CapacitorHttp can't abort an in-flight request directly, so race its
        // response against the external signal and clean up the listener when
        // either side settles. A user "stop" therefore surfaces promptly.
        const res = await requestWithAbort(
          () => CapacitorHttp.request(this.toOptions(init)),
          init.signal,
        );
        const status = res.status ?? 0;
        if (status < 200 || status >= 300) {
          const message = extractErrorMessage(res.data) ?? `HTTP ${status}`;
          throw new HttpError(message, status, statusToKind(status), res.data);
        }
        // The native plugin returns the body as a raw string whenever the
        // response Content-Type isn't detected as JSON — mirror the web client,
        // which always JSON.parses the text, so provider responses parse the
        // same way on every platform.
        if (typeof res.data === 'string') {
          try {
            return JSON.parse(res.data) as T;
          } catch {
            return res.data as T;
          }
        }
        return res.data as T;
      } catch (err) {
        lastError = err;
        if (attempt >= retries) throw lastError;
        const retryable = !(err instanceof HttpError) || RETRYABLE_STATUS.has(err.status);
        if (retryable) await delayMs(backoffMs(attempt, err instanceof HttpError ? err.status : undefined));
      }
    }
    throw lastError;
  }

  async requestSse(init: HttpRequestInit, onData: (payload: string) => void): Promise<void> {
    // Keep SSE cancellation semantics aligned with requestJson: callers can
    // stop a native live request without waiting for the full native timeout.
    const res = await requestWithAbort(
      () => CapacitorHttp.request({ ...this.toOptions(init), responseType: 'text' }),
      init.signal,
    );
    const status = res.status ?? 0;
    if (status < 200 || status >= 300) {
      const message = extractErrorMessage(res.data) ?? `SSE HTTP ${status}`;
      throw new HttpError(message, status, statusToKind(status), res.data);
    }
    const body = (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)).replace(/\r\n/g, '\n');
    for (const frame of body.split('\n\n')) {
      const lines = frame.split('\n').filter((l) => l.startsWith('data:'));
      if (lines.length === 0) continue;
      const payload = lines.map((l) => l.slice(5).trim()).join('');
      if (payload && payload !== '[DONE]') onData(payload);
    }
  }

  private toOptions(init: HttpRequestInit): HttpOptions {
    const options: HttpOptions = {
      url: init.url,
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    };
    if (init.body !== undefined) options.data = init.body;
    if (init.timeoutMs) {
      options.connectTimeout = init.timeoutMs;
      options.readTimeout = init.timeoutMs;
    }
    return options;
  }
}

function statusToKind(status: number): HttpError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 400 && status < 500) return 'bad-request';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Backoff between retries. Rate limits (429) get a much longer, capped
 * backoff — same rationale as the web FetchHttpClient.
 */
function backoffMs(attempt: number, status?: number): number {
  if (status === 429) return Math.min(2000 * Math.pow(2, attempt), 30_000);
  return Math.min(100 * Math.pow(2, attempt), 2000);
}
