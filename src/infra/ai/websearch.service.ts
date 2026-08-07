// WebSearchService — the "first step" of two-step live web search.
//
// The chat path sends the user's question to the chosen search backend, which
// runs a REAL web search and returns a grounded summary (never raw results
// shown to the user). That summary is injected into the chat request as
// context so the coach's answer can cite current facts (dates, scores,
// syllabus changes, news).
//
// Backends:
//   google       → Gemini generateContent with `google_search` grounding.
//   smartrotator → OpenAI-style chat completion with `{"type":"web_search"}`
//                  (the gateway executes the search and synthesizes).
//
// Search is a bonus: any failure returns { ok:false } instead of throwing, so
// the chat always proceeds with a normal (ungrounded) answer.

import type { HttpClient } from './http';
import type { LLMMessage } from '../../core/domain/llm';

export interface WebSearchContext {
  providerId: 'google' | 'smartrotator';
  /** Auth key for the search backend (Gemini key / SmartRotator session key). */
  apiKey: string;
  /** Base URL for the backend (no trailing slash, no /v1beta). */
  baseUrl: string;
  /** Model used by the backend (Gemini model for google; optional for the gateway). */
  model?: string;
}

export interface WebSearchResult {
  ok: boolean;
  text: string;
  error?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: Array<{ web?: { title?: string; uri?: string; snippet?: string } }>;
  };
}

interface OpenAICompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com';

/** Search answers stay short and factual — no chat-style fluff. */
const SEARCH_PROMPT =
  'Web search kar aur user ke sawal ka jawab de. Sirf search results se mile current facts use karo — dates, numbers, names, official statements. Agar results me jawab na ho to clearly bolo ki search results me nahi mila. End me "Sources:" list karo.';

export class WebSearchService {
  constructor(private readonly http: HttpClient) {}

  async search(ctx: WebSearchContext, messages: LLMMessage[], signal?: AbortSignal): Promise<WebSearchResult> {
    if (!ctx.apiKey) return { ok: false, text: '', error: 'no api key' };
    try {
      return ctx.providerId === 'google'
        ? await this.searchGoogle(ctx, messages, signal)
        : await this.searchSmartRotator(ctx, messages, signal);
    } catch (err) {
      return { ok: false, text: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async searchGoogle(ctx: WebSearchContext, messages: LLMMessage[], signal?: AbortSignal): Promise<WebSearchResult> {
    const model = ctx.model || 'gemini-2.5-flash';
    const base = (ctx.baseUrl || DEFAULT_GEMINI_BASE).replace(/\/+$/, '');
    const system = messages.find((m) => m.role === 'system')?.content;
    const systemText = typeof system === 'string' ? system : undefined;
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      const text = typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      if (!text) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      const previous = contents[contents.length - 1];
      if (previous?.role === role) previous.parts.push({ text });
      else contents.push({ role, parts: [{ text }] });
    }
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'Web search: ' + (systemText ?? '') }] });
    const res = await this.http.requestJson<GeminiGenerateResponse>({
      url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': ctx.apiKey },
      body: {
        contents,
        ...(systemText ? { system_instruction: { parts: [{ text: `${SEARCH_PROMPT}\n${systemText}` }] } } : { system_instruction: { parts: [{ text: SEARCH_PROMPT }] } }),
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      },
      timeoutMs: 60_000,
      retries: 0,
      signal,
    });
    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
    const chunks = (res?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => {
        const title = c.web?.title?.trim();
        const snippet = c.web?.snippet?.trim();
        const uri = c.web?.uri?.trim();
        return [title, snippet].filter(Boolean).join(' — ') + (uri ? ` (${uri})` : '');
      })
      .filter(Boolean);
    const sources = chunks.length > 0 ? `\n\nSources:\n${chunks.map((c) => `- ${c}`).join('\n')}` : '';
    if (!text && !chunks.length) return { ok: false, text: '', error: 'empty grounding result' };
    return { ok: true, text: text + sources };
  }

  private async searchSmartRotator(ctx: WebSearchContext, messages: LLMMessage[], signal?: AbortSignal): Promise<WebSearchResult> {
    const res = await this.http.requestJson<OpenAICompletionResponse>({
      url: `${ctx.baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
      body: {
        ...(ctx.model ? { model: ctx.model } : {}),
        messages: [
          { role: 'system', content: SEARCH_PROMPT },
          ...messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
        ],
        temperature: 0.2,
        max_tokens: 2048,
        stream: false,
        tools: [{ type: 'web_search' }],
      },
      timeoutMs: 60_000,
      retries: 0,
      signal,
    });
    const text = res?.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) return { ok: false, text: '', error: 'empty search answer' };
    return { ok: true, text };
  }
}
