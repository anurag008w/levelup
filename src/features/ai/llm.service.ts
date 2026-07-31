import type { LLMMessage, LLMRequest, LLMResponse, ProviderConfig } from '../../core/domain/llm';
import { isAbortError, ProviderError } from '../../core/domain/llm';
import type { ProviderFactory } from '../../infra/ai/provider-factory';
import type { ProviderSettingsService } from './provider-settings.service';

interface ChainEntry {
  config: ProviderConfig;
  model: string;
}

/**
 * Resilient LLM facade: tries the active provider (and its fallback model),
 * then every other usable provider in order, then the hidden env default.
 * Failures on one provider never surface before the whole chain is exhausted.
 */
export class LLMService {
  private readonly factory: ProviderFactory;
  private readonly settings: ProviderSettingsService;

  constructor(factory: ProviderFactory, settings: ProviderSettingsService) {
    this.factory = factory;
    this.settings = settings;
  }

  isAvailable(): boolean {
    return this.settings.isAiEnabled();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!this.settings.isAiEnabled()) {
      throw new ProviderError('none', 'bad-request', 'AI is disabled or no provider is configured');
    }
    if (request.model) return this.tryChain(request, [{ config: this.requireActive(), model: request.model }]);
    return this.tryChain(request, this.buildChain());
  }

  async stream(request: LLMRequest): Promise<LLMResponse> {
    if (!this.settings.isAiEnabled()) {
      throw new ProviderError('none', 'bad-request', 'AI is disabled or no provider is configured');
    }
    const streamed = { ...request, stream: true };
    if (request.model) return this.tryChain(streamed, [{ config: this.requireActive(), model: request.model }]);
    return this.tryChain(streamed, this.buildChain());
  }

  private async tryChain(request: LLMRequest, chain: ChainEntry[]): Promise<LLMResponse> {
    let lastError: unknown;
    for (const entry of chain) {
      try {
        const provider = this.factory.create(entry.config);
        const req = { ...request, model: entry.model };
        return request.stream ? await provider.stream(req) : await provider.complete(req);
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  private buildChain(): ChainEntry[] {
    const active = this.settings.getActiveProvider();
    if (!active) throw new ProviderError('none', 'bad-request', 'no usable provider configured');
    const all = this.settings.allRaw().filter((p) => this.settings.isUsable(p));
    const ordered = [active, ...all.filter((p) => p.id !== active.id)];
    const chain: ChainEntry[] = [];
    const seen = new Set<string>();
    for (const config of ordered) {
      const model = config.model;
      if (!model) continue;
      const fallback = config.fallbackModel && config.fallbackModel !== model ? config.fallbackModel : null;
      const candidates = fallback ? [fallback, model] : [model];
      for (const m of candidates) {
        const key = `${config.id}:${m}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chain.push({ config, model: m });
      }
    }
    return chain;
  }

  private requireActive(): ProviderConfig {
    const active = this.settings.getActiveProvider();
    if (!active) throw new ProviderError('none', 'bad-request', 'no usable provider configured');
    return active;
  }
}

export type { LLMMessage };
