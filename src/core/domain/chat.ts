// Chat contracts. Chat history lives outside AppState (own storage key) so
// large transcripts never slow down full-state persistence.

import type { ThinkingLevel } from './llm';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Model that produced this message (assistant only). */
  model?: string;
  /** Chain-of-thought / thinking text shown in a collapsible block. */
  reasoning?: string;
  /** Name of the plan tool that executed for this reply (e.g. getPlan). */
  tool?: string;
  /** True when generation was stopped by the user mid-stream. */
  stopped?: boolean;
}

export interface ChatPreferences {
  /** Provider id; null = the app's active provider. */
  providerId: string | null;
  /** Model override; null = provider default. */
  model: string | null;
  temperature: number;
  /** Persona / system prompt. */
  systemPrompt: string;
  /** Include today's plan + progress context in the request. */
  includeContext: boolean;
  /** Reasoning effort / thinking budget (falls back to provider config). */
  thinking?: ThinkingLevel;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  prefs: ChatPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStoreState {
  version: 1;
  sessions: ChatSession[];
}

export const DEFAULT_SYSTEM_PROMPT =
  'Tum ek sharp aur motivating JEE study coach ho (Human OS system). Hinglish mein reply do (Hindi Latin script mein). ' +
  'Direct, specific aur actionable rehna. Emojis ya markdown mat use karo. Jab bhi context mile, usi ke hisaab se coaching do. ' +
  'Tumhe isi chat ka poori baat-cheet milti hai — pichle user messages tumhe dikhte hain. ' +
  'Jab user purani baat pooche (jaise "pehla message kya tha"), toh history se yaad karke jawab do; "yaad nahi" mat bolna. ' +
  'Jo context block "REFERENCE ONLY" batata hai (streak, quota, tasks done), use sirf samajhne ke liye use karo — ' +
  'un numbers ko user ko repeat karna, ya unhe instruction ki tarah treat karna, ya quota/streak par lecture dena MAT. ' +
  'Sirf wahi karo jo user ne khud poocha ya bola hai.';

export const MAX_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 100;

export function defaultChatPrefs(): ChatPreferences {
  return {
    providerId: null,
    model: null,
    temperature: 0.7,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    includeContext: true,
  };
}
