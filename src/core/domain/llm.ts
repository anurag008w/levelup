// Provider-agnostic LLM contracts. All AI features depend on these interfaces,
// never on a specific provider.

export type ProviderId =
  | 'openrouter'
  | 'gemini'
  | 'opencode'
  | 'opencode-zen'
  | 'openai-compatible'
  | 'custom';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** Base URL of the provider API. */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  timeoutMs?: number;
  retries?: number;
  customHeaders?: Record<string, string>;
  enabled: boolean;
  /** True when configured via environment variables only (hidden default). */
  hidden?: boolean;
  /** Default reasoning/thinking budget for this provider's models. */
  thinking?: ThinkingLevel;
}

export type ContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; alt?: string };

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface LLMRequest {
  messages: LLMMessage[];
  /** Provider override; omitted = app active provider/fallback chain. */
  providerId?: string | null;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onDelta?: (delta: string) => void;
  /** Streamed reasoning/thinking tokens (if the provider exposes them). */
  onReasoningDelta?: (delta: string) => void;
  /** Reasoning effort / thinking budget for the model. */
  thinking?: ThinkingLevel;
  /** External abort signal (chat stop button). */
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  usage?: LLMUsage;
  /** Chain-of-thought / thinking text when the provider returns it. */
  reasoning?: string;
}

export interface ModelModalities {
  input: string[];
  output: string[];
}

export interface ModelPricing {
  /** USD per 1M prompt tokens. */
  prompt?: number;
  /** USD per 1M completion tokens. */
  completion?: number;
}

export interface ModelInfo {
  id: string;
  /** Human-readable display name. */
  name: string;
  provider: ProviderId;
  contextLength: number | null;
  modalities: ModelModalities;
  supportsStreaming: boolean | null;
  supportsVision: boolean | null;
  supportsReasoning: boolean | null;
  supportsToolCalling: boolean | null;
  supportsStructuredOutputs: boolean | null;
  supportsThinking: boolean | null;
  pricing: ModelPricing | null;
  isFree: boolean;
  deprecated: boolean;
  /** Unix ms when this record was fetched. */
  fetchedAt: number;
}

export type ProviderErrorKind = 'auth' | 'rate-limit' | 'timeout' | 'network' | 'bad-request' | 'server' | 'unknown' | 'aborted';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly provider: string;

  constructor(provider: string, kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

export interface HealthCheckResult {
  ok: boolean;
  provider: string;
  latencyMs: number;
  message?: string;
}

/** True for any abort-caused failure, including duck-typed provider errors. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.kind === 'aborted';
  return typeof err === 'object' && err !== null && 'kind' in err && (err as { kind?: unknown }).kind === 'aborted';
}

/** The one contract every provider adapter implements. */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  isConfigured(): boolean;
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): Promise<LLMResponse>;
  fetchModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<HealthCheckResult>;
}

export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
