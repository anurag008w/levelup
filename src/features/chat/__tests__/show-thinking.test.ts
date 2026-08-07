// Regression: the "Show thinking" feature — thinking setting -> request ->
// provider reasoning -> message.reasoning persisted in the repo (displayed by
// the collapsible ThinkingBlock in ChatScreen when chat.showThinking is on).
import { describe, it, expect } from 'vitest';
import { ChatService } from '../../../features/chat/chat.service';
import { LLMService } from '../../../features/ai/llm.service';
import { ProviderSettingsService } from '../../../features/ai/provider-settings.service';
import { emptyAppState } from '../../../core/domain/state';
import { defaultChatPrefs } from '../../../core/domain/chat';
import type { ChatStoreState } from '../../../core/domain/chat';
import type { ChatRepository, StateStore } from '../../../core/ports/repositories';
import type { LLMProvider, LLMResponse, LLMRequest, HealthCheckResult, ModelInfo, ProviderId } from '../../../core/domain/llm';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import type { AppState } from '../../../types';

class MemoryChatRepository implements ChatRepository {
  private state: ChatStoreState = { version: 1, sessions: [] };
  load(): ChatStoreState {
    return this.state;
  }
  save(state: ChatStoreState): void {
    this.state = state;
  }
}

class FakeClock {
  private t = new Date('2026-07-31T10:00:00Z');
  now(): Date {
    return new Date(this.t);
  }
}

function makeStore(initial: Partial<AppState['aiSettings']>): StateStore {
  let state: AppState = { ...emptyAppState(), aiSettings: { ...emptyAppState().aiSettings, ...initial } };
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

function reasoningProvider(streaming: boolean, onCapture?: (req: LLMRequest) => void): LLMProvider {
  const id: ProviderId = 'openrouter';
  return {
    id,
    label: 'OpenRouter',
    isConfigured: () => true,
    complete: async (): Promise<LLMResponse> => ({ text: '', model: id }),
    stream: async (req: LLMRequest): Promise<LLMResponse> => {
      onCapture?.(req);
      req.onDelta?.('Hello!');
      if (streaming) req.onReasoningDelta?.('pehle user ka context dekho, phir jawab do');
      return streaming
        ? { text: 'Hello!', model: id, reasoning: 'pehle user ka context dekho, phir jawab do' }
        : { text: 'Hello!', model: id };
    },
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: id, latencyMs: 1 }),
  };
}

function build(store: StateStore, provider: LLMProvider): { chat: ChatService; repo: MemoryChatRepository } {
  const repo = new MemoryChatRepository();
  const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
  const settings = new ProviderSettingsService(store, factory);
  const llm = new LLMService(factory, settings);
  const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, null, store);
  return { chat, repo };
}

describe('show thinking end-to-end', () => {
  it('thinking level is sent in the request and reasoning lands in the message + repo', async () => {
    let captured: LLMRequest | undefined;
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    });
    const { chat, repo } = build(store, reasoningProvider(true, (req) => (captured = req)));
    const s = chat.createSession('q', { ...defaultChatPrefs(), thinking: 'medium' });
    const result = await chat.send(s.id, 'socho aur jawab do');
    expect(captured?.thinking).toBe('medium');
    expect(result.reasoning).toContain('pehle user ka context');
    const reloaded = repo.load();
    const savedMsg = reloaded.sessions.find((x) => x.id === s.id)?.messages.find((m) => m.role === 'assistant');
    expect(savedMsg?.reasoning).toContain('pehle user ka context');
  });

  it('no thinking level -> no reasoning requested and no reasoning in message', async () => {
    let captured: LLMRequest | undefined;
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    });
    const { chat } = build(store, reasoningProvider(false, (req) => (captured = req)));
    const s = chat.createSession('q', { ...defaultChatPrefs(), thinking: undefined });
    const result = await chat.send(s.id, 'socho aur jawab do');
    expect(captured?.thinking).toBeUndefined();
    expect(result.reasoning).toBeUndefined();
  });
});
