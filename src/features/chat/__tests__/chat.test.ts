import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import type { ChatRepository } from '../../../core/ports/repositories';
import type { ChatStoreState } from '../../../core/domain/chat';
import type { LLMProvider, ProviderError, LLMResponse, HealthCheckResult, ModelInfo, LLMRequest, ProviderId } from '../../../core/domain/llm';
import type { StateStore } from '../../../core/ports/repositories';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { LLMService } from '../../ai/llm.service';
import { ProviderSettingsService } from '../../ai/provider-settings.service';
import { ChatService } from '../chat.service';

class MemoryChatRepository implements ChatRepository {
  private state: ChatStoreState = { version: 1, sessions: [] };
  load(): ChatStoreState {
    return this.state;
  }
  save(state: ChatStoreState): void {
    this.state = state;
  }
}

/** Mimics localStorage: every load returns a freshly parsed object graph. */
class FreshLoadChatRepository implements ChatRepository {
  private raw = '{"version":1,"sessions":[]}';
  load(): ChatStoreState {
    return JSON.parse(this.raw) as ChatStoreState;
  }
  save(state: ChatStoreState): void {
    this.raw = JSON.stringify(state);
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

function makeStreamingProvider(id: ProviderId, replies: string[], errors: unknown[] = []): LLMProvider {
  let calls = 0;
  return {
    id,
    label: id,
    isConfigured: () => true,
    complete: async (): Promise<LLMResponse> => ({ text: '', model: id }),
    stream: async (req: LLMRequest): Promise<LLMResponse> => {
      const idx = calls;
      calls += 1;
      const text = replies[idx] ?? '';
      if (req.onDelta) {
        for (const ch of text) req.onDelta(ch);
      }
      if (errors[idx]) throw errors[idx];
      return { text, model: id };
    },
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: id, latencyMs: 1 }),
  };
}

function buildService(deps: {
  replies?: string[];
  errors?: unknown[];
  context?: () => string;
  aiSettings?: Partial<AppState['aiSettings']>;
  repo?: ChatRepository;
}): { chat: ChatService; repo: ChatRepository } {
  const repo = deps.repo ?? new MemoryChatRepository();
  const store = makeStore(
    deps.aiSettings ?? {
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    },
  );
  const provider = makeStreamingProvider('openrouter', deps.replies ?? ['hi there'], deps.errors ?? []);
  const factory: ProviderFactory = {
    create: () => provider,
  } as unknown as ProviderFactory;
  const settings = new ProviderSettingsService(store, factory);
  const llm = new LLMService(factory, settings);
  const chat = new ChatService(repo, llm, settings, deps.context ?? (() => 'ctx'), new FakeClock());
  return { chat, repo };
}

describe('ChatService', () => {
  it('creates, lists and deletes sessions', () => {
    const { chat } = buildService({});
    const s1 = chat.createSession('pehla');
    const s2 = chat.createSession();
    expect(chat.listSessions().map((s) => s.id)).toEqual([s2.id, s1.id]);
    chat.deleteSession(s1.id);
    expect(chat.listSessions().map((s) => s.id)).toEqual([s2.id]);
  });

  it('derives a title from the first message and persists messages', async () => {
    const { chat, repo } = buildService({ replies: ['namaste'] });
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'Kal ka plan kya tha?');
    const stored = repo.load().sessions[0];
    expect(stored.title).toBe('Kal ka plan kya tha?');
    expect(stored.messages).toHaveLength(2);
    expect(stored.messages[0].role).toBe('user');
    expect(reply.content).toBe('namaste');
  });

  it('injects today context into the system prompt', async () => {
    let captured: LLMRequest | null = null;
    const repo = new MemoryChatRepository();
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    });
    const provider: LLMProvider = {
      id: 'openrouter',
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => ({ text: '', model: 'a' }),
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        captured = req;
        return { text: 'done', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const chat = new ChatService(repo, llm, settings, () => 'ctx-xyz', new FakeClock());
    const session = chat.createSession();
    await chat.send(session.id, 'hi');
    expect(captured).not.toBeNull();
    const systemContents = captured!.messages.filter((m) => m.role === 'system').map((m) => m.content);
    expect(systemContents.join('\n')).toContain('ctx-xyz');
    expect(systemContents[0]).toContain('JEE');
    expect(captured!.messages.at(-1)).toEqual({ role: 'user', content: 'hi' });
  });

  it('rolls back the user message when the provider errors hard', async () => {
    const err = Object.assign(new Error('server down'), { kind: 'server', provider: 'openrouter', status: 500 }) as ProviderError;
    const { chat, repo } = buildService({ errors: [err] });
    const session = chat.createSession();
    await expect(chat.send(session.id, 'message')).rejects.toThrow(/server down/);
    const stored = repo.load().sessions[0];
    expect(stored.messages).toHaveLength(0);
    expect(stored.title).toBe('');
  });

  it('keeps partial text as a stopped message when aborted', async () => {
    const aborted = Object.assign(new Error('cancelled'), { kind: 'aborted', provider: 'openrouter', status: 0 }) as ProviderError;
    const { chat, repo } = buildService({
      replies: ['partial-text'],
      errors: [aborted],
      aiSettings: {
        providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
        aiEnabled: true,
      },
    });
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'question');
    const stored = repo.load().sessions[0];
    expect(reply.content).toBe('partial-text');
    expect(reply.stopped).toBe(true);
    expect(stored.messages).toHaveLength(2);
  });

  it('honours custom provider and model in the request', async () => {
    const { chat } = buildService({ replies: ['ok'] });
    const session = chat.createSession();
    chat.updatePrefs(session.id, { ...session.prefs, providerId: 'openrouter', model: 'custom-model' });
    const reply = await chat.send(session.id, 'x');
    expect(reply.model).toBe('openrouter');
  });

  it('caps sessions at the limit', () => {
    const { chat } = buildService({});
    for (let i = 0; i < 25; i += 1) chat.createSession(`s${i}`);
    expect(chat.listSessions()).toHaveLength(20);
  });

  it('persists mutations across loads (fresh-parse repository)', async () => {
    const repo = new FreshLoadChatRepository();
    const { chat } = buildService({ repo, replies: ['reply'] });
    const session = chat.createSession();
    await chat.send(session.id, 'hello');
    const stored = repo.load().sessions[0];
    expect(stored.title).toBe('hello');
    expect(stored.messages.map((m) => m.content)).toEqual(['hello', 'reply']);
  });
});
