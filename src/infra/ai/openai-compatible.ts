import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelInfo,
  ProviderConfig,
  HealthCheckResult,
} from '../../core/domain/llm';
import { ProviderError } from '../../core/domain/llm';
import type { HttpClient, HttpError } from './http';

const MAX_MODEL_PAGES = 3;

/** Mappings shared by every OpenAI-compatible endpoint (OpenRouter, Zen, custom). */
export function mapOpenAIModel(raw: unknown, provider: ProviderConfig['id'], fetchedAt: number): ModelInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || m.id.length === 0) return null;

  const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as string[]) : [];
  const inputMods = Array.isArray(m.input_modalities) ? (m.input_modalities as string[]) : ['text'];
  const outputMods = Array.isArray(m.output_modalities) ? (m.output_modalities as string[]) : ['text'];

  const pricingRaw = (typeof m.pricing === 'object' && m.pricing !== null ? m.pricing : {}) as Record<string, unknown>;
  const prompt = toNumber(pricingRaw.prompt);
  const completion = toNumber(pricingRaw.completion);
  const isFree = prompt !== null && completion !== null && prompt === 0 && completion === 0;

  const contextLength = typeof m.context_length === 'number' ? m.context_length : typeof m.context_window === 'number' ? m.context_window : null;
  const deprecated =
    typeof m.deprecated === 'boolean'
      ? m.deprecated
      : typeof m.expiration_date === 'string'
        ? new Date(m.expiration_date).getTime() < Date.now()
        : false;

  return {
    id: m.id,
    name: typeof m.name === 'string' && m.name.length > 0 ? m.name : m.id,
    provider,
    contextLength,
    modalities: { input: inputMods, output: outputMods },
    supportsStreaming: params.length > 0 ? params.includes('streaming') : null,
    supportsVision: inputMods.includes('image') ? true : params.length > 0 ? params.includes('vision') : null,
    supportsReasoning: params.length > 0 ? params.includes('reasoning') : null,
    supportsToolCalling: params.length > 0 ? params.includes('tools') : null,
    supportsStructuredOutputs: params.length > 0 ? params.includes('structured_outputs') : null,
    supportsThinking: params.length > 0 ? params.includes('reasoning') || params.includes('thinking') : null,
    pricing: prompt !== null || completion !== null ? { prompt: prompt ?? undefined, completion: completion ?? undefined } : null,
    isFree,
    deprecated,
    fetchedAt,
  };
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface OpenAICompatibleOptions {
  /** Default base URL when the config does not provide one. */
  defaultBaseUrl: string;
  /** Extra headers always attached (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>;
}

/**
 * Provider adapter for any OpenAI-compatible chat completions API
 * (OpenRouter, OpenCode Zen, custom base URLs, ...).
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderConfig['id'];
  readonly label: string;
  readonly config: ProviderConfig;
  private readonly http: HttpClient;
  private readonly options: OpenAICompatibleOptions;

  constructor(config: ProviderConfig, http: HttpClient, options: OpenAICompatibleOptions) {
    this.config = config;
    this.http = http;
    this.options = options;
    this.id = config.id;
    this.label = config.label;
  }

  private baseUrl(): string {
    return (this.config.baseUrl ?? this.options.defaultBaseUrl).replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    if (this.config.apiKey) return true;
    // Local endpoints (ollama, llama.cpp, ...) may not require a key.
    const url = this.baseUrl();
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { ...(this.options.extraHeaders ?? {}), ...(this.config.customHeaders ?? {}) };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Convert ContentPart arrays to OpenAI format
    const messages = request.messages.map(msg => {
      if (typeof msg.content === 'string') return msg;
      return {
        ...msg,
        content: msg.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image') return { type: 'image_url', image_url: { url: part.image, alt: part.alt } };
          if (part.type === 'file') return { type: 'file', file: { filename: part.file.filename, file_data: part.file.file_data } };
          return part;
        })
      };
    });

    const body = {
      model: request.model ?? this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      stream: false,
      ...this.reasoningFields(request),
    };
    const res = await this.http.requestJson<OpenAICompletionResponse>(
      {
        url: `${this.baseUrl()}/chat/completions`,
        headers: this.headers(),
        body,
        timeoutMs: this.config.timeoutMs,
        retries: this.config.retries,
        signal: request.signal,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ).catch((err) => {
      throw this.normalize(err);
    });
    const text = res?.choices?.[0]?.message?.content ?? '';
    const reasoning = extractReasoning(res?.choices?.[0]?.message);
    return {
      text,
      model: res?.model ?? (request.model ?? this.config.model ?? ''),
      reasoning: reasoning || undefined,
      usage: res?.usage
        ? {
            inputTokens: res.usage.prompt_tokens,
            outputTokens: res.usage.completion_tokens,
            cost: res.usage.cost,
          }
        : undefined,
    };
  }

  async stream(request: LLMRequest): Promise<LLMResponse> {
    // Convert ContentPart arrays to OpenAI format
    const messages = request.messages.map(msg => {
      if (typeof msg.content === 'string') return msg;
      return {
        ...msg,
        content: msg.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image') return { type: 'image_url', image_url: { url: part.image, alt: part.alt } };
          if (part.type === 'file') return { type: 'file', file: { filename: part.file.filename, file_data: part.file.file_data } };
          return part;
        })
      };
    });

    const body = {
      model: request.model ?? this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      stream: true,
      ...this.reasoningFields(request),
    };
    let full = '';
    let reasoning = '';
    const onData = (payload: string) => {
      try {
        const chunk = JSON.parse(payload) as OpenAIStreamChunk;
        const delta = chunk?.choices?.[0]?.delta;
        const content = delta?.content;
        if (content) {
          full += content;
          request.onDelta?.(content);
        }
        const think = extractReasoning(delta);
        if (think) {
          reasoning += think;
          request.onReasoningDelta?.(think);
        }
      } catch {
        // Ignore malformed chunks.
      }
    };
    await this.http.requestSse(
      { url: `${this.baseUrl()}/chat/completions`, headers: this.headers(), body, timeoutMs: this.config.timeoutMs, retries: this.config.retries, signal: request.signal },
      onData,
    ).catch((err) => {
      throw this.normalize(err);
    });
    // Some gateways/proxies mishandle SSE and stream nothing. Fall back to a
    // single non-streaming call so the user still gets a reply.
    if (full.length === 0 && !request.signal?.aborted) {
      const resp = await this.complete(request);
      request.onDelta?.(resp.text);
      return resp;
    }
    return { text: full, model: request.model ?? this.config.model ?? '', reasoning: reasoning || undefined };
  }

  /** Provider-aware reasoning effort fields (OpenRouter vs generic chat completions). */
  private reasoningFields(request: LLMRequest): Record<string, unknown> {
    const level = request.thinking;
    if (!level || level === 'off') return {};
    if (this.id === 'openrouter') {
      return {
        reasoning: { effort: level },
        include_reasoning: true,
      };
    }
    return { reasoning_effort: level };
  }

  async fetchModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    let url = `${this.baseUrl()}/models`;
    for (let page = 0; page < MAX_MODEL_PAGES; page++) {
      const res = await this.http
        .requestJson<OpenAIModelsList>({ url, headers: this.headers(), method: 'GET', timeoutMs: this.config.timeoutMs, retries: this.config.retries })
        .catch((err) => {
          throw this.normalize(err);
        });
      for (const raw of res?.data ?? []) {
        const model = mapOpenAIModel(raw, this.id, Date.now());
        if (model) models.push(model);
      }
      const next = (res as { next_page_token?: string }).next_page_token ?? (res as { last_id?: string }).last_id;
      if (!next || models.length === 0) break;
      url = `${this.baseUrl()}/models?after=${encodeURIComponent(next)}`;
    }
    return models;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    
    // Must have API key for remote providers
    if (!this.config.apiKey) {
      return { ok: false, provider: this.id, latencyMs: Date.now() - start, message: 'API key missing' };
    }
    
    try {
      await this.http.requestJson<unknown>({
        url: `${this.baseUrl()}/models`,
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

interface OpenAICompletionResponse {
  choices?: Array<{ message?: OpenAIResponseMessage }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

interface OpenAIResponseMessage {
  content?: string | null;
  /** Reasoning text (DeepSeek/OpenRouter style). */
  reasoning_content?: string | null;
  reasoning?: string | null;
}

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: OpenAIResponseMessage }>;
}

function extractReasoning(message: OpenAIResponseMessage | undefined): string {
  if (!message) return '';
  return typeof message.reasoning_content === 'string'
    ? message.reasoning_content
    : typeof message.reasoning === 'string'
      ? message.reasoning
      : '';
}

interface OpenAIModelsList {
  data?: unknown[];
}
