import type { LLMProvider, ProviderConfig, ProviderId } from '../../core/domain/llm';
import type { HttpClient } from './http';
import { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './openai-compatible';
import { GeminiProvider } from './gemini';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1';

const OPENROUTER_TITLE = 'JEE Human OS';
const OPENROUTER_REFERER = 'https://jee-human-os.local';

/**
 * Hidden default provider configured only via environment variables
 * (VITE_DEFAULT_AI_*). Its API key and model name are never surfaced to the
 * UI or logs; presence alone is reported.
 */
export function buildHiddenDefaultConfig(env: Record<string, string | undefined> = readEnv()): ProviderConfig | null {
  const baseUrl = env.VITE_DEFAULT_AI_BASE_URL;
  const apiKey = env.VITE_DEFAULT_AI_API_KEY;
  const model = env.VITE_DEFAULT_AI_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  return {
    id: 'custom',
    label: 'Default',
    baseUrl,
    apiKey,
    model,
    temperature: env.VITE_DEFAULT_AI_TEMPERATURE !== undefined ? Number(env.VITE_DEFAULT_AI_TEMPERATURE) : 0.7,
    maxTokens: env.VITE_DEFAULT_AI_MAX_TOKENS !== undefined ? Number(env.VITE_DEFAULT_AI_MAX_TOKENS) : 2048,
    timeoutMs: env.VITE_DEFAULT_AI_TIMEOUT_MS !== undefined ? Number(env.VITE_DEFAULT_AI_TIMEOUT_MS) : 30_000,
    retries: 1,
    streaming: true,
    enabled: true,
    hidden: true,
  };
}

function readEnv(): Record<string, string | undefined> {
  const e = import.meta.env as Record<string, string | undefined>;
  return {
    VITE_DEFAULT_AI_BASE_URL: e.VITE_DEFAULT_AI_BASE_URL,
    VITE_DEFAULT_AI_API_KEY: e.VITE_DEFAULT_AI_API_KEY,
    VITE_DEFAULT_AI_MODEL: e.VITE_DEFAULT_AI_MODEL,
    VITE_DEFAULT_AI_TEMPERATURE: e.VITE_DEFAULT_AI_TEMPERATURE,
    VITE_DEFAULT_AI_MAX_TOKENS: e.VITE_DEFAULT_AI_MAX_TOKENS,
    VITE_DEFAULT_AI_TIMEOUT_MS: e.VITE_DEFAULT_AI_TIMEOUT_MS,
  };
}

export function providerLabel(id: ProviderId): string {
  switch (id) {
    case 'openrouter':
      return 'OpenRouter';
    case 'gemini':
      return 'Gemini';
    case 'opencode':
    case 'opencode-zen':
      return 'OpenCode Zen';
    case 'openai-compatible':
    case 'custom':
      return 'Custom';
  }
}

/** Instantiates a provider adapter for a given persisted/hidden config. */
export class ProviderFactory {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  create(config: ProviderConfig): LLMProvider {
    switch (config.id) {
      case 'gemini':
        return new GeminiProvider(config, this.http);
      case 'openrouter':
        return new OpenAICompatibleProvider(config, this.http, {
          defaultBaseUrl: OPENROUTER_BASE_URL,
          extraHeaders: {
            'HTTP-Referer': OPENROUTER_REFERER,
            'X-OpenRouter-Title': OPENROUTER_TITLE,
          },
        } satisfies OpenAICompatibleOptions);
      case 'opencode':
      case 'opencode-zen':
        return new OpenAICompatibleProvider(config, this.http, { defaultBaseUrl: OPENCODE_BASE_URL });
      case 'openai-compatible':
      case 'custom':
      default:
        return new OpenAICompatibleProvider(config, this.http, { defaultBaseUrl: '' });
    }
  }
}
