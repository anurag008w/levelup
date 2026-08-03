// App-level auth against the SmartRotator gateway server.
//
// The session lives OUTSIDE AppState on purpose: it gates the whole app, so it
// must survive state resets, never leak into backups, and stay readable before
// any store exists. On mobile the request goes through the native HTTP stack
// (no CORS); on web it falls back to fetch (the server must send CORS headers).

import { container } from '../di/container';
import type { ProviderConfig } from '../core/domain/llm';

export interface AuthSession {
  /** Server root — no trailing slash, no /v1 (e.g. https://smartrotator.onrender.com). */
  serverUrl: string;
  username: string;
  role: string;
  /** The user's sk-... key — used as the OpenAI-compatible API key. */
  apiKey: string;
  /** Dashboard JWT (kept for future /auth/me quota calls). */
  token: string;
  loggedInAt: string;
}

const SESSION_KEY = 'levelup.auth.session';
export const DEFAULT_SERVER_URL = 'https://smartrotator.onrender.com';

/** Model id the app requests by default; the gateway routes it among providers. */
export const SERVER_DEFAULT_MODEL = 'gemini-2.5-flash';

export function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    if (!s || typeof s.serverUrl !== 'string' || typeof s.apiKey !== 'string' || typeof s.username !== 'string') return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Server root from the build-time secret (VITE_DEFAULT_AI_BASE_URL is injected
 * by GitHub Actions). Falls back to the public gateway for local development.
 */
export function serverRootFromEnv(): string {
  const env = (import.meta.env as Record<string, string | undefined>).VITE_DEFAULT_AI_BASE_URL;
  if (!env) return DEFAULT_SERVER_URL;
  return normalizeServerRoot(env);
}

/** Normalizes any user/env URL to a bare server root (no /v1, no trailing slash). */
export function normalizeServerRoot(url: string): string {
  let u = (url || '').trim();
  u = u.split('?')[0] ?? '';
  u = u.split('#')[0] ?? '';
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/api\/v1$/, '');
  u = u.replace(/\/v1$/, '');
  return u;
}

/** OpenAI-compatible base for a server root: root + /v1. */
export function ensureV1Base(root: string): string {
  const clean = normalizeServerRoot(root);
  return clean ? `${clean}/v1` : '';
}

/** Builds the persisted "My Server" provider used by the chat after login. */
export function buildServerProvider(session: AuthSession): ProviderConfig {
  return {
    id: 'rotator',
    label: 'My Server',
    baseUrl: ensureV1Base(session.serverUrl),
    apiKey: session.apiKey,
    model: SERVER_DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 4096,
    timeoutMs: 120_000,
    retries: 1,
    streaming: true,
    enabled: true,
  };
}

interface AuthResponse {
  token?: string;
  api_key?: string;
  user?: { username?: string; role?: string };
}

export async function loginToServer(serverUrl: string, username: string, password: string): Promise<AuthSession> {
  const root = normalizeServerRoot(serverUrl);
  const data = await postAuth<AuthResponse>(`${root}/auth/login`, { username, password });
  return toSession(root, username, data);
}

export async function registerOnServer(serverUrl: string, username: string, password: string): Promise<AuthSession> {
  const root = normalizeServerRoot(serverUrl);
  const data = await postAuth<AuthResponse>(`${root}/auth/register`, { username, password });
  return toSession(root, username, data);
}

function toSession(root: string, username: string, data: AuthResponse): AuthSession {
  return {
    serverUrl: root,
    username: data.user?.username ?? username,
    role: data.user?.role ?? 'user',
    apiKey: data.api_key ?? '',
    token: data.token ?? '',
    loggedInAt: new Date().toISOString(),
  };
}

async function postAuth<T>(url: string, body: unknown): Promise<T> {
  try {
    return await container.http.requestJson<T>({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: 15_000,
      retries: 0,
    });
  } catch (err) {
    throw friendlyAuthError(err);
  }
}

/** Maps raw transport errors to clear, Hinglish-friendly messages. */
export function friendlyAuthError(err: unknown): Error {
  if (err instanceof Error) {
    const msg = err.message;
    if (/401|invalid username|invalid credentials|wrong password/i.test(msg)) {
      return new Error('Username ya password galat hai. Agar account exist nahi karta, "Register" tab use karo.');
    }
    if (/409|already taken|exists/i.test(msg)) {
      return new Error('Username pehle se exist karta hai — "Login" tab se sign in karo.');
    }
    if (/network|failed to fetch|load failed|socket/i.test(msg)) {
      return new Error('Server se connect nahi hua — Server URL check karo aur internet on hai confirm karo.');
    }
    if (/404|not found/i.test(msg)) {
      return new Error('Server URL pe /auth/login nahi mila — galat server address hai.');
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
