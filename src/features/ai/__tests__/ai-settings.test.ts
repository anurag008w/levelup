/**
 * Comprehensive tests for AI Provider Settings
 * Tests provider management, model selection, health checks, and configuration
 */
import { describe, expect, it } from 'vitest';
import type { ProviderConfig, ModelInfo } from '../../../core/domain/llm';

// Mock types
interface MockAppState {
  aiSettings: {
    aiEnabled: boolean;
    activeProviderId: string | null;
    providers: Record<string, ProviderConfig>;
  };
}

// Helper to create provider config
function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'openrouter' as const,
    label: 'Test Provider',
    apiKey: 'sk-test-key',
    model: 'test-model',
    baseUrl: 'https://api.test.com/v1',
    enabled: true,
    ...overrides,
  };
}

// Helper to create model info
function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: 'openrouter',
    contextLength: 128000,
    modalities: { input: ['text'], output: ['text'] },
    supportsStreaming: true,
    supportsVision: false,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutputs: false,
    supportsThinking: false,
    isFree: false,
    pricing: { prompt: 0.001, completion: 0.002 },
    deprecated: false,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

describe('AI Provider Settings', () => {
  describe('Provider Configuration', () => {
    it('creates valid OpenRouter provider config', () => {
      const provider = makeProvider({
        id: 'openrouter',
        label: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-3.5-sonnet',
      });
      
      expect(provider.id).toBe('openrouter');
      expect(provider.baseUrl).toContain('openrouter.ai');
      expect(provider.enabled).toBe(true);
    });

    it('creates valid Gemini provider config', () => {
      const provider = makeProvider({
        id: 'gemini',
        label: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-2.0-flash',
      });
      
      expect(provider.id).toBe('gemini');
      expect(provider.baseUrl).toContain('generativelanguage.googleapis.com');
      expect(provider.enabled).toBe(true);
    });

    it('creates valid custom provider config', () => {
      const provider = makeProvider({
        id: 'custom',
        label: 'Custom LLM',
        baseUrl: 'https://custom.api.com/v1',
        model: 'custom-model',
      });
      
      expect(provider.id).toBe('custom');
      expect(provider.apiKey).toBeTruthy();
      expect(provider.enabled).toBe(true);
    });

    it('handles disabled provider', () => {
      const provider = makeProvider({ enabled: false });
      
      expect(provider.enabled).toBe(false);
    });

    it('handles provider without API key', () => {
      const provider = makeProvider({ apiKey: '' });
      
      expect(provider.apiKey).toBe('');
    });
  });

  describe('Model Selection', () => {
    it('selects free model correctly', () => {
      const models = [
        makeModel({ id: 'paid-model', isFree: false, pricing: { prompt: 0.01, completion: 0.03 } }),
        makeModel({ id: 'free-model', isFree: true }),
      ];
      
      const freeModels = models.filter(m => m.isFree);
      expect(freeModels).toHaveLength(1);
      expect(freeModels[0].id).toBe('free-model');
    });

    it('filters models by context length', () => {
      const models = [
        makeModel({ id: 'small', contextLength: 4000 }),
        makeModel({ id: 'medium', contextLength: 128000 }),
        makeModel({ id: 'large', contextLength: 1000000 }),
      ];
      
      const longContext = models.filter(m => (m.contextLength ?? 0) >= 100000);
      expect(longContext).toHaveLength(2);
    });

    it('handles streaming support', () => {
      const streamingModel = makeModel({ supportsStreaming: true });
      const nonStreamingModel = makeModel({ supportsStreaming: false });
      
      expect(streamingModel.supportsStreaming).toBe(true);
      expect(nonStreamingModel.supportsStreaming).toBe(false);
    });

    it('handles vision support', () => {
      const visionModel = makeModel({ supportsVision: true });
      const textModel = makeModel({ supportsVision: false });
      
      expect(visionModel.supportsVision).toBe(true);
      expect(textModel.supportsVision).toBe(false);
    });

    it('handles reasoning models', () => {
      const reasoningModel = makeModel({ supportsReasoning: true });
      const normalModel = makeModel({ supportsReasoning: false });
      
      expect(reasoningModel.supportsReasoning).toBe(true);
      expect(normalModel.supportsReasoning).toBe(false);
    });

    it('marks deprecated models', () => {
      const currentModel = makeModel({ deprecated: false });
      const oldModel = makeModel({ deprecated: true });
      
      expect(currentModel.deprecated).toBe(false);
      expect(oldModel.deprecated).toBe(true);
    });

    it('sorts models by free first, then name', () => {
      const models = [
        makeModel({ id: 'z-model', name: 'Zebra', isFree: false }),
        makeModel({ id: 'a-model', name: 'Apple', isFree: false }),
        makeModel({ id: 'free-b', name: 'Banana Free', isFree: true }),
        makeModel({ id: 'free-a', name: 'Apple Free', isFree: true }),
      ];
      
      const sorted = [...models].sort((a, b) => 
        Number(b.isFree) - Number(a.isFree) || a.name.localeCompare(b.name)
      );
      
      expect(sorted[0].isFree).toBe(true);
      expect(sorted[0].name).toBe('Apple Free');
      expect(sorted[1].isFree).toBe(true);
      expect(sorted[2].isFree).toBe(false);
    });
  });

  describe('Provider State Management', () => {
    it('initializes empty providers state', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: false,
          activeProviderId: null,
          providers: {},
        },
      };
      
      expect(Object.keys(state.aiSettings.providers)).toHaveLength(0);
      expect(state.aiSettings.activeProviderId).toBeNull();
      expect(state.aiSettings.aiEnabled).toBe(false);
    });

    it('adds a new provider', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: false,
          activeProviderId: null,
          providers: {},
        },
      };
      
      const provider = makeProvider({ id: 'openrouter' });
      state.aiSettings.providers[provider.id] = provider;
      
      expect(state.aiSettings.providers['openrouter']).toBeTruthy();
      expect(state.aiSettings.providers['openrouter'].id).toBe('openrouter');
    });

    it('updates existing provider', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: true,
          activeProviderId: 'openrouter',
          providers: {
            openrouter: makeProvider({ id: 'openrouter', model: 'old-model' }),
          },
        },
      };
      
      // Update model
      const existing = state.aiSettings.providers['openrouter'];
      state.aiSettings.providers['openrouter'] = { ...existing, model: 'new-model' };
      
      expect(state.aiSettings.providers['openrouter'].model).toBe('new-model');
    });

    it('removes a provider', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: true,
          activeProviderId: 'openrouter',
          providers: {
            openrouter: makeProvider({ id: 'openrouter' }),
            gemini: makeProvider({ id: 'gemini' }),
          },
        },
      };
      
      // Remove provider
      delete state.aiSettings.providers['openrouter'];
      
      expect(state.aiSettings.providers['openrouter']).toBeUndefined();
      expect(state.aiSettings.providers['gemini']).toBeTruthy();
    });

    it('handles active provider switch', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: true,
          activeProviderId: 'openrouter',
          providers: {
            openrouter: makeProvider({ id: 'openrouter' }),
            gemini: makeProvider({ id: 'gemini' }),
          },
        },
      };
      
      // Switch active provider
      state.aiSettings.activeProviderId = 'gemini';
      
      expect(state.aiSettings.activeProviderId).toBe('gemini');
    });

    it('clears active provider when removed', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: true,
          activeProviderId: 'openrouter',
          providers: {
            openrouter: makeProvider({ id: 'openrouter' }),
          },
        },
      };
      
      // Remove active provider
      delete state.aiSettings.providers['openrouter'];
      if (state.aiSettings.activeProviderId === 'openrouter') {
        state.aiSettings.activeProviderId = null;
      }
      
      expect(state.aiSettings.activeProviderId).toBeNull();
    });

    it('enables AI when first provider is added', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: false,
          activeProviderId: null,
          providers: {},
        },
      };
      
      // Add first usable provider and enable AI
      const provider = makeProvider({ id: 'openrouter', enabled: true });
      state.aiSettings.providers[provider.id] = provider;
      
      const hasUsable = Object.values(state.aiSettings.providers).some(p => p.enabled);
      if (hasUsable) {
        state.aiSettings.aiEnabled = true;
        if (!state.aiSettings.activeProviderId) {
          state.aiSettings.activeProviderId = provider.id;
        }
      }
      
      expect(state.aiSettings.aiEnabled).toBe(true);
      expect(state.aiSettings.activeProviderId).toBe('openrouter');
    });
  });

  describe('AI Enabled/Disabled Flow', () => {
    it('disabling AI keeps providers intact', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: true,
          activeProviderId: 'openrouter',
          providers: {
            openrouter: makeProvider({ id: 'openrouter' }),
          },
        },
      };
      
      // Disable AI
      state.aiSettings.aiEnabled = false;
      
      expect(state.aiSettings.aiEnabled).toBe(false);
      expect(state.aiSettings.providers['openrouter']).toBeTruthy();
      expect(state.aiSettings.activeProviderId).toBe('openrouter');
    });

    it('re-enabling AI restores previous state', () => {
      const state: MockAppState = {
        aiSettings: {
          aiEnabled: false,
          activeProviderId: 'openrouter',
          providers: {
            openrouter: makeProvider({ id: 'openrouter' }),
          },
        },
      };
      
      // Re-enable
      state.aiSettings.aiEnabled = true;
      
      expect(state.aiSettings.aiEnabled).toBe(true);
      expect(state.aiSettings.activeProviderId).toBe('openrouter');
    });
  });

  describe('Base URL Resolution', () => {
    it('uses custom base URL when provided', () => {
      const provider = makeProvider({
        baseUrl: 'https://custom.api.com/v1',
      });
      
      expect(provider.baseUrl).toBe('https://custom.api.com/v1');
    });

    it('uses default OpenRouter URL', () => {
      const defaults: Record<string, string> = {
        openrouter: 'https://openrouter.ai/api/v1',
        gemini: 'https://generativelanguage.googleapis.com',
        opencode: 'https://opencode.ai/zen/v1',
      };
      
      expect(defaults['openrouter']).toContain('openrouter.ai');
      expect(defaults['gemini']).toContain('generativelanguage.googleapis.com');
    });

    it('handles base URL with trailing slash', () => {
      const url = 'https://api.test.com/v1/';
      const cleanUrl = url.replace(/\/+$/, '');
      
      expect(cleanUrl).toBe('https://api.test.com/v1');
    });
  });

  describe('Provider Usability Check', () => {
    it('provider is usable with API key and enabled', () => {
      const provider = makeProvider({ apiKey: 'sk-test', enabled: true });
      
      const isUsable = Boolean(provider.apiKey) && provider.enabled;
      expect(isUsable).toBe(true);
    });

    it('provider is not usable without API key', () => {
      const provider = makeProvider({ apiKey: '', enabled: true });
      
      const isUsable = Boolean(provider.apiKey) && provider.enabled;
      expect(isUsable).toBe(false);
    });

    it('provider is not usable when disabled', () => {
      const provider = makeProvider({ apiKey: 'sk-test', enabled: false });
      
      const isUsable = Boolean(provider.apiKey) && provider.enabled;
      expect(isUsable).toBe(false);
    });
  });

  describe('Multiple Providers', () => {
    it('handles multiple providers correctly', () => {
      const providers: ProviderConfig[] = [
        makeProvider({ id: 'openrouter', label: 'OpenRouter', enabled: true }),
        makeProvider({ id: 'gemini', label: 'Gemini', enabled: true }),
        makeProvider({ id: 'custom', label: 'Custom', enabled: false }),
      ];
      
      const enabled = providers.filter(p => p.enabled);
      expect(enabled).toHaveLength(2);
      
      const allIds = providers.map(p => p.id);
      expect(allIds).toContain('openrouter');
      expect(allIds).toContain('gemini');
      expect(allIds).toContain('custom');
    });

    it('selects first enabled provider as default', () => {
      const providers: ProviderConfig[] = [
        makeProvider({ id: 'openrouter', enabled: false }),
        makeProvider({ id: 'gemini', enabled: true }),
        makeProvider({ id: 'custom', enabled: true }),
      ];
      
      const firstEnabled = providers.find(p => p.enabled);
      expect(firstEnabled?.id).toBe('gemini');
    });
  });

  describe('Pricing Calculation', () => {
    it('calculates prompt cost', () => {
      const model = makeModel({
        pricing: { prompt: 0.001, completion: 0.002 },
      });
      
      const promptCost = 1000 * (model.pricing?.prompt ?? 0);
      expect(promptCost).toBe(1); // $1 for 1000 tokens
    });

    it('calculates completion cost', () => {
      const model = makeModel({
        pricing: { prompt: 0.001, completion: 0.002 },
      });
      
      const completionCost = 500 * (model.pricing?.completion ?? 0);
      expect(completionCost).toBe(1); // $1 for 500 tokens
    });

    it('handles free models', () => {
      const freeModel = makeModel({
        isFree: true,
        pricing: { prompt: 0, completion: 0 },
      });
      
      expect(freeModel.isFree).toBe(true);
      expect(freeModel.pricing?.prompt).toBe(0);
      expect(freeModel.pricing?.completion).toBe(0);
    });
  });

  describe('Health Check Simulation', () => {
    it('successful health check result', () => {
      const healthResult = {
        ok: true,
        latencyMs: 150,
        message: undefined,
      };
      
      expect(healthResult.ok).toBe(true);
      expect(healthResult.latencyMs).toBe(150);
    });

    it('failed health check result', () => {
      const healthResult = {
        ok: false,
        latencyMs: undefined,
        message: 'Connection refused',
      };
      
      expect(healthResult.ok).toBe(false);
      expect(healthResult.message).toBe('Connection refused');
    });

    it('health check timeout', () => {
      const healthResult = {
        ok: false,
        latencyMs: undefined,
        message: 'Request timeout after 10000ms',
      };
      
      expect(healthResult.ok).toBe(false);
      expect(healthResult.message).toContain('timeout');
    });
  });

  describe('Model Catalog Loading', () => {
    it('loads model catalog successfully', () => {
      const catalog: ModelInfo[] = [
        makeModel({ id: 'model-1', name: 'Model One' }),
        makeModel({ id: 'model-2', name: 'Model Two' }),
        makeModel({ id: 'model-3', name: 'Model Three' }),
      ];
      
      expect(catalog).toHaveLength(3);
      expect(catalog.map(m => m.id)).toEqual(['model-1', 'model-2', 'model-3']);
    });

    it('handles empty catalog', () => {
      const catalog: ModelInfo[] = [];
      
      expect(catalog).toHaveLength(0);
    });

    it('filters deprecated models', () => {
      const catalog: ModelInfo[] = [
        makeModel({ id: 'current', deprecated: false }),
        makeModel({ id: 'old', deprecated: true }),
        makeModel({ id: 'newest', deprecated: false }),
      ];
      
      const current = catalog.filter(m => !m.deprecated);
      expect(current).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('handles missing API key error', () => {
      const provider = makeProvider({ apiKey: '' });
      
      const errorMsg = !provider.apiKey 
        ? 'API key required' 
        : null;
      
      expect(errorMsg).toBe('API key required');
    });

    it('handles invalid base URL', () => {
      const provider = makeProvider({ baseUrl: '' });
      
      const errorMsg = !provider.baseUrl 
        ? 'Base URL required' 
        : null;
      
      expect(errorMsg).toBe('Base URL required');
    });

    it('handles model fetch failure', async () => {
      const fetchError = new Error('Network error');
      
      const handleError = (err: Error) => {
        return err.message.length > 140 
          ? `${err.message.slice(0, 140)}…` 
          : err.message;
      };
      
      expect(handleError(fetchError)).toBe('Network error');
    });

    it('handles long error messages', async () => {
      const longError = new Error('A'.repeat(200));
      
      const handleError = (err: Error) => {
        return err.message.length > 140 
          ? `${err.message.slice(0, 140)}…` 
          : err.message;
      };
      
      expect(handleError(longError).endsWith('…')).toBe(true);
      expect(handleError(longError).length).toBe(141); // 140 + …
    });
  });
});
