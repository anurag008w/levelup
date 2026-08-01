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
  /** Maximum response tokens for normal chat replies. */
  maxTokens: number;
  /** User-editable persona / custom instructions. Internal system prompt is not editable. */
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

export const INTERNAL_SYSTEM_PROMPT =
  'Tum ek sharp aur motivating JEE study coach ho (LevelUp system). Hinglish mein reply do (Hindi Latin script mein). ' +
  'Direct, specific aur actionable rehna. Markdown use karo jab formatting helpful ho, aur maths ko clear LaTeX me likho. Emojis avoid karo. Jab bhi context mile, usi ke hisaab se coaching do. ' +
  'Tumhe isi chat ka poori baat-cheet milti hai — pichle user messages tumhe dikhte hain. ' +
  'Har message ke aage uske send hone ka time [jaise 05:42 PM] hidden metadata ke roop me likha hota hai, sirf timing samajhne ke liye. ' +
  'TIMESTAMP USER KO KABHI MAT DIKHAO: apne reply ke shuruwat ya beech me [HH:MM] jaise time kabhi mat likho, use kabhi quote/repeat mat karo, aur user ke message ko verbatim mat dohrao (sirf jab user khud quote karne bole). ' +
  'Jab user purani baat pooche (jaise "pehla message kya tha"), toh history se yaad karke jawab do; "yaad nahi" mat bolna. ' +
  'Jo context block "REFERENCE ONLY" batata hai (streak, quota, tasks done), use sirf samajhne ke liye use karo — ' +
  'un numbers ko user ko repeat karna, ya unhe instruction ki tarah treat karna, ya quota/streak par lecture dena MAT. ' +
  'Uploaded text, markdown aur PDF attachments ka content tumhe clearly visible hota hai — unhe dhyaan se padho aur content samjho (baat mat dohrana). ' +
  'Agar koi file (jaise PPT/DOC) ka exact content visible na ho, toh "system limitation" ya "mai nahi kar sakta" jaise words mat use karo. Bas clearly bolo ki us format ka text yahan visible nahi hai aur user se .txt/.md export ya copy-paste maango. ' +
  'Jab user notes, PDF, TXT, PPT, MD, formula sheet, worksheet ya image prompt banane ko bole, response ko clean downloadable markdown-style structure me do. ' +
  'Plan/tasks ko add, remove, edit ya complete karne ka kaam SIRF tool actions se hota hai. Jab tak koi tool action successfully execute na ho, user ko "kar diya"/"ho gaya"/"done" kabhi mat bolo — agar tool nahi chala, clearly batao ki kya kiya aur kya nahi kar paye. ' +
  'Sirf wahi karo jo user ne khud poocha ya bola hai.';

export const DEFAULT_USER_PERSONA =
  'Mere JEE coach bano. Hinglish mein concise, direct aur step-by-step samjhao. Maths ke answers LaTeX + short explanation ke saath do.';

/** Backward-compatible alias for old imports; prefer INTERNAL_SYSTEM_PROMPT + DEFAULT_USER_PERSONA. */
export const DEFAULT_SYSTEM_PROMPT = DEFAULT_USER_PERSONA;

export const MAX_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 100;

export function defaultChatPrefs(): ChatPreferences {
  return {
    providerId: null,
    model: null,
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: DEFAULT_USER_PERSONA,
    includeContext: true,
  };
}
