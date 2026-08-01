// Chat contracts. Chat history lives outside AppState (own storage key) so
// large transcripts never slow down full-state persistence.

import type { ThinkingLevel } from './llm';

export type ChatRole = 'user' | 'assistant';

export interface ChatAttachment {
  id: string;
  name: string;
  kind: 'text' | 'image' | 'binary';
  previewUrl?: string;
}

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
  /** Attachments for this message (images, PDFs, etc.) */
  attachments?: ChatAttachment[];
}

export interface ChatPreferences {
  /** Provider id; null = the app's active provider. */
  providerId: string | null;
  /** Model override; null = provider default. */
  model: string | null;
  temperature: number;
  /** Maximum response tokens for normal chat replies. */
  maxTokens: number;
  /** User-editable system persona / coach instructions. */
  systemPrompt: string;
  /** Optional user-side persona / personal custom instructions. Blank by default. */
  userPersona: string;
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

export const INTERNAL_SYSTEM_PROMPT =
  'Tum Divya ho — LevelUp ki warm, sharp aur motivating JEE study coach. Identity Divya hi rakhna. Hinglish (Hindi Latin) mein caring didi/coach tone mein reply do: confident, practical, friendly, par childish ya flirty nahi. ' +
  'Direct, specific aur actionable rehna. Markdown sirf helpful ho tab use karo. Maths/Physics/Chemistry formulas clean LaTeX mein likho: inline \\( ... \\), display \\[ ... \\], derivations mein aligned blocks; LaTeX ko code fence mein mat daalna. Emojis avoid karo. ' +
  'Puri chat history aur visible attachments dhyaan se use karo. Hidden timestamps ko kabhi show, quote ya repeat mat karo; user messages verbatim mat dohrao jab tak user quote na maange. Purani baat pooche toh history se jawab do. ' +
  'REFERENCE ONLY context sirf samajhne ke liye hai; streak/quota/tasks numbers repeat ya lecture mat karo. Agar PPT/DOC jaisa text visible na ho, bas bolo ki text yahan visible nahi hai aur .txt/.md export ya copy-paste maango. ' +
  'Notes, PDFs, formula sheets, worksheets ya image prompts ke liye clean downloadable markdown-style structure do. Plan/tasks add, edit, remove ya complete sirf tool action se hote hain; tool success ke bina "kar diya", "ho gaya" ya "done" mat bolo. Sirf wahi karo jo user ne poocha hai.';

export const DEFAULT_USER_PERSONA = '';

/** Backward-compatible alias for old imports; prefer INTERNAL_SYSTEM_PROMPT + DEFAULT_USER_PERSONA. */
export const DEFAULT_SYSTEM_PROMPT = INTERNAL_SYSTEM_PROMPT;

export const MAX_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 100;

export function defaultChatPrefs(): ChatPreferences {
  return {
    providerId: null,
    model: null,
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: INTERNAL_SYSTEM_PROMPT,
    userPersona: DEFAULT_USER_PERSONA,
    includeContext: true,
  };
}
