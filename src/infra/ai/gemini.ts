import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelInfo,
  ProviderConfig,
  ProviderId,
  HealthCheckResult,
  ThinkingLevel,
} from '../../core/domain/llm';
import { ProviderError } from '../../core/domain/llm';
import type { HttpClient, HttpError } from './http';

const MAX_GEMINI_MODEL_PAGES = 5;

const THINKING_BUDGETS: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  low: 2048,
  medium: 4096,
  high: 16384,
};

interface GeminiRolePart {
  role?: string;
  parts: Array<{ text?: string; thought?: boolean }>;
}

interface GeminiGenerateRequest {
  contents: GeminiRolePart[];
  system_instruction?: { parts: Array<{ text: string }> };
  tools?: Array<{ google_search: Record<string, never> }>;
  generationConfig: {
    temperature?: number;
    maxOutputTokens?: number;
    thinkingConfig?: { thinkingBudget: number };
  };
}interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface GeminiModelsList {
  models?: Array<Record<string, unknown>>;
  nextPageToken?: string;
}

/** Gemini native REST adapter (v1beta). */
export class GeminiProvider implements LLMProvider {
  readonly id: ProviderConfig['id'];
  readonly label: string;
  readonly config: ProviderConfig;
  private readonly http: HttpClient;

  constructor(config: ProviderConfig, http: HttpClient) {
    this.config = config;
    this.http = http;
    this.id = config.id;
    this.label = config.label;
  }

  private baseUrl(): string {
    return (this.config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  private headers(): Record<string, string> {
    return { ...(this.config.customHeaders ?? {}), 'x-goog-api-key': this.config.apiKey ?? '' };
  }

  private resolveModel(request: LLMRequest): string {
    const model = request.model ?? this.config.model;
    if (!model) throw new ProviderError(this.id, 'bad-request', 'no model configured for Gemini provider');
    // The Gemini models API returns ids as "models/gemini-*", while the
    // generateContent path already includes /models/. If a saved config keeps
    // the raw API name, using it verbatim creates /models/models%2F... and
    // Gemini rejects the request as "Request contains an invalid argument".
    return model.replace(/^models\//, '');
  }

  private buildBody(request: LLMRequest): GeminiGenerateRequest {
    const contents: GeminiRolePart[] = [];
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (!systemInstruction) systemInstruction = { parts: [] };
        const text = typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
        systemInstruction.parts.push({ text });
      } else if (msg.content) {
        const parts: { text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { mimeType: string; fileUri: string } }[] = [];
        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else {
          for (const part of msg.content) {
            if (part.type === 'text') parts.push({ text: part.text });
            if (part.type === 'image') {
              // Read the MIME type from the data URL header instead of
              // assuming JPEG — a PNG/WebP labelled image/jpeg is rejected or
              // corrupted by Gemini.
              const comma = part.image.indexOf(',');
              const header = comma > 0 ? part.image.slice(0, comma) : '';
              const base64 = comma > 0 ? part.image.slice(comma + 1) : part.image;
              const mimeType = /^data:([^;,]+)/.exec(header)?.[1] ?? 'image/jpeg';
              parts.push({ inlineData: { mimeType, data: base64 } });
            }
            if (part.type === 'file') {
              // Gemini has no "file_data" part — inline raw bytes as base64.
              // `fileData` would require an already-uploaded Files-API URI, so a
              // raw data URL there fails; inlineData is the correct shape.
              const comma = part.file.file_data.indexOf(',');
              const header = comma > 0 ? part.file.file_data.slice(0, comma) : '';
              const base64 = comma > 0 ? part.file.file_data.slice(comma + 1) : part.file.file_data;
              const mimeType = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/pdf';
              parts.push({ inlineData: { mimeType, data: base64 } });
            }
          }
        }
        if (parts.length > 0) {
          const role = msg.role === 'assistant' ? 'model' : 'user';
          const previous = contents[contents.length - 1];
          // Gemini is stricter than OpenAI-style chat APIs: adjacent turns with
          // the same role (common when the tool loop appends corrective user
          // context) can be rejected as an invalid argument. Merge them into a
          // single Content entry so every tool decision/retry/replan shape is
          // accepted by the native API.
          if (previous?.role === role) previous.parts.push(...parts);
          else contents.push({ role, parts });
        }
      }
    }
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    const maxTokens = request.maxTokens ?? this.config.maxTokens;
    let thinkingConfig: { thinkingBudget: number } | undefined;
    if (request.thinking && request.thinking !== 'off') {
      const requested = THINKING_BUDGETS[request.thinking];
      // Gemini requires thinkingBudget < maxOutputTokens. Reserve a guaranteed
      // output window so a reasoning model never burns its whole budget
      // thinking (which surfaces as a blank reply). When there isn't enough
      // room to leave that window, skip thinking entirely.
      if (maxTokens !== undefined) {
        const room = maxTokens - 512;
        thinkingConfig = room >= 256 ? { thinkingBudget: Math.min(requested, room) } : undefined;
      } else {
        thinkingConfig = { thinkingBudget: requested };
      }
    }
    return {
      contents,
      ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
      // Live web search (Google Search grounding): the model grounds its answer
      // with fresh web results ONLY when it decides current info is needed. The
      // user only ever sees the model's synthesized answer — never raw results.
      // NOTE: `google_search` is the current tool shape for Gemini 2.5/3.x.
      // `googleSearchRetrieval` was the Gemini 1.5-era name — current models
      // reject it (which silently killed grounding before the graceful retry).
      ...(request.websearch ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        ...(request.temperature ?? this.config.temperature !== undefined ? { temperature: request.temperature ?? this.config.temperature } : {}),
        ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
        ...(thinkingConfig !== undefined ? { thinkingConfig } : {}),
      },
    };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = this.resolveModel(request);
    try {
      return await this.generateOnce(request, model);
    } catch (err) {
      // Some models don't accept the googleSearchRetrieval tool. Retry once
      // WITHOUT web search so the answer still arrives — grounding is a
      // capability bonus, never a hard requirement.
      if (request.websearch && looksLikeToolError(err)) {
        request.websearch = false;
        return await this.generateOnce(request, model);
      }
      throw err;
    }
  }

  private async generateOnce(request: LLMRequest, model: string): Promise<LLMResponse> {
    const body = this.buildBody(request);
    const res = await this.http
      .requestJson<GeminiGenerateResponse>(
        {
          url: `${this.baseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          headers: this.headers(),
          body,
          timeoutMs: this.config.timeoutMs,
          retries: this.config.retries,
          signal: request.signal,
        },
      )
      .catch((err) => {
        throw this.normalize(err);
      });
    const split = splitParts(res?.candidates?.[0]?.content?.parts);
    return {
      text: split.text,
      model,
      reasoning: split.reasoning || undefined,
      usage: res?.usageMetadata
        ? {
            inputTokens: res.usageMetadata.promptTokenCount,
            outputTokens: res.usageMetadata.candidatesTokenCount,
          }
        : undefined,
    };
  }

  async stream(request: LLMRequest): Promise<LLMResponse> {
    const model = this.resolveModel(request);
    try {
      return await this.streamOnce(request, model);
    } catch (err) {
      // Same graceful fallback as complete(): retry without web search when
      // the model rejects the grounding tool.
      if (request.websearch && looksLikeToolError(err)) {
        request.websearch = false;
        return await this.streamOnce(request, model);
      }
      throw err;
    }
  }

  private async streamOnce(request: LLMRequest, model: string): Promise<LLMResponse> {
    const body = this.buildBody(request);
    let full = '';
    let reasoning = '';
    const onData = (payload: string) => {
      try {
        const chunk = JSON.parse(payload) as GeminiGenerateResponse;
        const parts = chunk?.candidates?.[0]?.content?.parts;
        if (!parts) return;
        const split = splitParts(parts);
        if (split.text) {
          full += split.text;
          request.onDelta?.(split.text);
        }
        if (split.reasoning) {
          reasoning += split.reasoning;
          request.onReasoningDelta?.(split.reasoning);
        }
      } catch {
        // Ignore malformed chunks.
      }
    };
    await this.http
      .requestSse(
        {
          url: `${this.baseUrl()}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
          headers: this.headers(),
          body,
          timeoutMs: this.config.timeoutMs,
          retries: this.config.retries,
          signal: request.signal,
        },
        onData,
      )
      .catch((err) => {
        throw this.normalize(err);
      });
    // If the streamed response carried no content, fall back to one non-streaming call.
    if (full.length === 0 && !request.signal?.aborted) {
      const resp = await this.complete(request);
      request.onDelta?.(resp.text);
      return resp;
    }
    return { text: full, model, reasoning: reasoning || undefined };
  }

  async fetchModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_GEMINI_MODEL_PAGES; page++) {
      const url =
        `${this.baseUrl()}/v1beta/models?pageSize=200` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await this.http
        .requestJson<GeminiModelsList>({ url, headers: this.headers(), method: 'GET', timeoutMs: this.config.timeoutMs, retries: this.config.retries })
        .catch((err) => {
          throw this.normalize(err);
        });
      for (const raw of res?.models ?? []) {
        const model = mapGeminiModel(raw, this.id, Date.now());
        if (model) models.push(model);
      }
      pageToken = res?.nextPageToken;
      if (!pageToken) break;
    }
    return models;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.http.requestJson<unknown>({
        url: `${this.baseUrl()}/v1beta/models`,
        headers: this.headers(),
        method: 'GET',
        timeoutMs: Math.min(this.config.timeoutMs ?? 15_000, 15_000),
        retries: 0,
      });
      return { ok: true, provider: this.id, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, provider: this.id, latencyMs: Date.now() - start, message: err instanceof Error ? err.message : 'health check failed' };
    }
  }

  normalize(err: unknown): ProviderError {
    const httpErr = err as HttpError;
    const kind = httpErr.kind ?? 'unknown';
    return new ProviderError(this.id, kind, err instanceof Error ? err.message : 'provider request failed', httpErr.status);
  }
}

export function mapGeminiModel(raw: Record<string, unknown>, provider: ProviderId, fetchedAt: number): ModelInfo | null {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const id = name.replace(/^models\//, '');
  if (!id) return null;
  const displayName = typeof raw.displayName === 'string' ? raw.displayName : id;
  const description = typeof raw.description === 'string' ? raw.description : '';
  const methods = Array.isArray(raw.supportedGenerationMethods) ? (raw.supportedGenerationMethods as string[]) : [];
  const desc = description.toLowerCase();
  return {
    id,
    name: displayName,
    provider,
    contextLength: typeof raw.inputTokenLimit === 'number' ? raw.inputTokenLimit : null,
    modalities: { input: ['text'], output: ['text'] },
    supportsStreaming: methods.includes('streamGenerateContent'),
    supportsVision: /vision|image|multimodal/.test(desc) ? true : null,
    supportsReasoning: /reasoning/.test(desc) ? true : null,
    supportsToolCalling: /function calling|tools/.test(desc) ? true : null,
    supportsStructuredOutputs: null,
    supportsThinking: /thinking/.test(desc) ? true : null,
    pricing: null,
    isFree: false,
    deprecated: false,
    fetchedAt,
  };
}

/** Splits Gemini content parts into visible text vs thinking (thought) text. */
export function splitParts(parts: Array<{ text?: string; thought?: boolean }> | undefined): { text: string; reasoning: string } {
  let text = '';
  let reasoning = '';
  for (const part of parts ?? []) {
    const value = part.text ?? '';
    if (part.thought) reasoning += value;
    else text += value;
  }
  return { text, reasoning };
}

/**
 * True when a Gemini API error means the model doesn't support the
 * google_search grounding tool (or the tools field itself). Triggered by the
 * generic 400s Gemini returns for unsupported tools, so the caller can retry
 * the same request without web search instead of failing the whole reply.
 */
function looksLikeToolError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /google.?search|not supported|does not support|invalid argument/i.test(message);
}
