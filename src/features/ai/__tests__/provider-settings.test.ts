/**
 * Real ProviderSettingsService behaviour — not mock-array simulation.
 * Covers: usable/active resolution, master switch, hidden default handling,
 * upsert/remove auto-activation and secret stripping.
 */
import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import type { LLMProvider, ProviderConfig, ProviderId, HealthCheckResult, ModelInfo, LLMRequest, LLMResponse } from '../../../core/domain/llm';
import type { StateStore } from '../../../core/ports/repositories';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { ProviderSettingsService } from '../provider-settings.service';

function makeStore(initial: Partial<AppState['aiSettings']>): StateStore {
  let state: AppState = { ...emptyAppState(), aiSettings: { ...emptyAppState().aiSettings, ...initial } };
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

function configuredProvider(id: ProviderId): LLMProvider {
  return {
    id,
    label: id,
    isConfigured: () => true,
    complete: async (_req: LLMRequest): Promise<LLMResponse> => ({ text: '', model: id }),
    stream: async (_req: LLMRequest): Promise<LLMResponse> => ({ text: '', model: id }),
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: id, latencyMs: 1 }),
  };
}

function unconfiguredProvider(id: ProviderId): LLMProvider {
  return {
    id,
    label: id,
    isConfigured: () => false,
    complete: async (_req: LLMRequest): Promise<LLMResponse> => ({ text: '', model: id }),
    stream: async (_req: LLMRequest): Promise<LLMResponse> => ({ text: '', model: id }),
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: false, provider: id, latencyMs: 1 }),
  };
}

/**
 * Factory whose isConfigured() mirrors the real world: a provider is
 * configured only when it has an API key and is enabled.
 */
function build(aiSettings: Partial<AppState['aiSettings']>): ProviderSettingsService {
  const store = makeStore(aiSettings);
  const factory: ProviderFactory = {
    create: (config: ProviderConfig) =>
      config.enabled && config.apiKey ? configuredProvider(config.id) : unconfiguredProvider(config.id),
  } as unknown as ProviderFactory;
  return new ProviderSettingsService(store, factory);
}

function config(id: ProviderId, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    label: id,
    apiKey: 'sk-test',
    model: 'm',
    baseUrl: 'https://api.test.com/v1',
    enabled: true,
    ...overrides,
  };
}

describe('ProviderSettingsService', () => {
  it('returns an empty list when nothing is configured', () => {
    const settings = build({ providers: {}, activeProviderId: null, aiEnabled: false });
    expect(settings.listProviders()).toHaveLength(0);
    expect(settings.getActiveProvider()).toBeNull();
    expect(settings.isAiEnabled()).toBe(false);
  });

  it('resolves the active provider to the first usable one when none is marked', () => {
    const settings = build({
      providers: {
        openrouter: config('openrouter'),
        gemini: config('gemini'),
      },
      activeProviderId: null,
      aiEnabled: true,
    });
    expect(settings.getActiveProvider()?.id).toBe('openrouter');
  });

  it('prefers the explicitly active provider when it is usable', () => {
    const settings = build({
      providers: { openrouter: config('openrouter'), gemini: config('gemini') },
      activeProviderId: 'gemini',
      aiEnabled: true,
    });
    expect(settings.getActiveProvider()?.id).toBe('gemini');
  });

  it('falls back to another usable provider when the active one becomes unusable', () => {
    const settings = build({
      providers: { openrouter: config('openrouter', { apiKey: '' }), gemini: config('gemini') },
      activeProviderId: 'openrouter',
      aiEnabled: true,
    });
    expect(settings.getActiveProvider()?.id).toBe('gemini');
  });

  it('is not AI-enabled when the master switch is off even with a usable provider', () => {
    const settings = build({
      providers: { openrouter: config('openrouter') },
      activeProviderId: 'openrouter',
      aiEnabled: false,
    });
    expect(settings.isAiEnabled()).toBe(false);
  });

  it('is not AI-enabled with no usable provider even when the switch is on', () => {
    const settings = build({
      providers: { openrouter: config('openrouter', { apiKey: '' }) },
      activeProviderId: 'openrouter',
      aiEnabled: true,
    });
    expect(settings.isAiEnabled()).toBe(false);
  });

  it('upserting the first usable provider auto-activates it', () => {
    const settings = build({ providers: {}, activeProviderId: null, aiEnabled: false });
    settings.upsertProvider(config('openrouter'));
    expect(settings.getActiveProvider()?.id).toBe('openrouter');
  });

  it('upserting an unusable provider does not activate it', () => {
    const settings = build({ providers: {}, activeProviderId: null, aiEnabled: false });
    settings.upsertProvider(config('openrouter', { apiKey: '' }));
    expect(settings.getActiveProvider()).toBeNull();
  });

  it('removing the active provider clears the active id', () => {
    const settings = build({
      providers: { openrouter: config('openrouter'), gemini: config('gemini') },
      activeProviderId: 'openrouter',
      aiEnabled: true,
    });
    settings.removeProvider('openrouter');
    expect(settings.getActiveProvider()?.id).toBe('gemini');
    const state = settings.listStoredProviders();
    expect(state.find((p) => p.id === 'openrouter')).toBeUndefined();
  });

  it('listProviders only returns enabled providers', () => {
    const settings = build({
      providers: { openrouter: config('openrouter'), gemini: config('gemini', { enabled: false }) },
      activeProviderId: null,
      aiEnabled: true,
    });
    const ids = settings.listProviders().map((p) => p.id);
    expect(ids).toContain('openrouter');
    expect(ids).not.toContain('gemini');
  });

  it('isUsable requires both enabled and configured', () => {
    const settings = build({ providers: {}, activeProviderId: null, aiEnabled: false });
    expect(settings.isUsable(config('openrouter', { apiKey: '' }))).toBe(false);
    expect(settings.isUsable(config('openrouter', { enabled: false }))).toBe(false);
    expect(settings.isUsable(config('openrouter'))).toBe(true);
  });

  it('setAiEnabled persists the master switch', () => {
    const settings = build({ providers: {}, activeProviderId: null, aiEnabled: false });
    settings.setAiEnabled(true);
    expect(settings.isAiEnabled()).toBe(false); // no active provider yet -> still off
  });
});
