import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import type { ChatRepository } from '../../../core/ports/repositories';
import { defaultChatPrefs, type ChatStoreState } from '../../../core/domain/chat';
import type { ContentPart, LLMProvider, LLMResponse, HealthCheckResult, ModelInfo, LLMRequest, ProviderId } from '../../../core/domain/llm';
import { ProviderError } from '../../../core/domain/llm';
import type { StateStore } from '../../../core/ports/repositories';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { LLMService } from '../../ai/llm.service';
import { MemoryService } from '../../ai/memory.service';
import { ProviderSettingsService } from '../../ai/provider-settings.service';
import { ChatService } from '../chat.service';
import { MemoryToolsService } from '../memory-tools.service';

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

/** Makes blob URL -> data URL conversion work in Node (FileReader + fetch). */
function stubBlobUtils(): () => void {
  const g = globalThis as Record<string, unknown>;
  const originalReader = g.FileReader;
  const originalFetch = g.fetch;
  g.FileReader = class {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          const base64 = Buffer.from(buf).toString('base64');
          this.result = `data:${(blob.type || 'application/octet-stream')};base64,${base64}`;
          this.onloadend?.();
        })
        .catch(() => this.onerror?.());
    }
  };
  g.fetch = async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }));
  return () => {
    g.FileReader = originalReader;
    g.fetch = originalFetch;
  };
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
  withMemory?: boolean;
}): { chat: ChatService; repo: ChatRepository; store: StateStore } {
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
  const memory = deps.withMemory ? new MemoryService(new FakeClock()) : null;
  const chat = new ChatService(repo, llm, settings, deps.context ?? (() => 'ctx'), new FakeClock(), null, memory, deps.withMemory ? store : null);
  return { chat, repo, store };
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


  it('creates sessions with supplied global chat defaults', () => {
    const { chat } = buildService({});
    const session = chat.createSession('', {
      ...defaultChatPrefs(),
      temperature: 0.2,
      maxTokens: 1024,
      systemPrompt: 'system-real',
      userPersona: 'user-real',
      includeContext: false,
    });

    expect(session.prefs.temperature).toBe(0.2);
    expect(session.prefs.maxTokens).toBe(1024);
    expect(session.prefs.systemPrompt).toBe('system-real');
    expect(session.prefs.userPersona).toBe('user-real');
    expect(session.prefs.includeContext).toBe(false);
  });

  it('applies global chat settings to every session without touching session-only fields', () => {
    const { chat } = buildService({});
    const s1 = chat.createSession();
    const s2 = chat.createSession('', {
      ...defaultChatPrefs(),
      temperature: 0.1,
      providerId: 'openrouter',
      model: 'special-model',
      thinking: 'high',
    });

    chat.applyGlobalPrefs({
      temperature: 0.9,
      maxTokens: 4096,
      systemPrompt: 'system-global',
      userPersona: 'user-global',
      includeContext: false,
    });

    const [first, second] = chat.listSessions();
    for (const s of [first, second]) {
      expect(s.prefs.temperature).toBe(0.9);
      expect(s.prefs.maxTokens).toBe(4096);
      expect(s.prefs.systemPrompt).toBe('system-global');
      expect(s.prefs.userPersona).toBe('user-global');
      expect(s.prefs.includeContext).toBe(false);
    }
    // Newest session is first; session-only fields survive the global sync.
    expect(first.id).toBe(s2.id);
    expect(first.prefs.providerId).toBe('openrouter');
    expect(first.prefs.model).toBe('special-model');
    expect(first.prefs.thinking).toBe('high');
    expect(second.id).toBe(s1.id);
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
    const last = captured!.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/^\[[^\]]+\] hi$/);
  });

  it('tags every history message with its local send time', async () => {
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
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock());
    const session = chat.createSession();
    await chat.send(session.id, 'pehla');
    await chat.send(session.id, 'doosra');
    const history = captured!.messages.filter((m) => m.role !== 'system');
    expect(history).toHaveLength(3);
    for (const m of history) expect(m.content).toMatch(/^\[[^\]]+\] /);
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

  it('persists the raw transcript of a finished session into memory on new chat', async () => {
    const { chat, store } = buildService({ replies: ['reply-one', 'reply-two'], withMemory: true });
    const s1 = chat.createSession();
    await chat.send(s1.id, 'Meri aim IIT hai');

    // Before a new chat is created, no raw messages are dumped into memory.
    expect(store.get().memory.entries).toHaveLength(0);

    // Starting a new chat persists the previous transcript verbatim.
    chat.createSession();
    await chat.summarizePriorChats();

    const entries = store.get().memory.entries.filter((e) => e.type === 'conversation');
    expect(entries.length).toBeGreaterThan(0);
    const stored = entries.find((e) => e.context.tags.includes(s1.id));
    expect(stored).toBeDefined();
    // Both sides are kept raw — no AI condensation.
    expect(stored?.content).toContain('Student: Meri aim IIT hai');
    expect(stored?.content).toContain('AI Coach:');
    expect(stored?.blockId).toBe(`chat:${s1.id}`);
    expect(stored?.summarized).toBe(false);

    // A session is only persisted once.
    await chat.summarizePriorChats();
    const entriesAfter = store.get().memory.entries.filter((e) => e.type === 'conversation');
    expect(entriesAfter).toHaveLength(entries.length);
  });

  it('recalls stored earlier-conversation transcripts into later sessions', async () => {
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
    const memory = new MemoryService(new FakeClock());
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, memory, store);
    const s1 = chat.createSession();
    await chat.send(s1.id, 'Meri aim IIT ka preparation hai');

    // New chat stores the transcript; it is recalled into later sessions.
    chat.createSession();
    await chat.summarizePriorChats();
    const s2 = chat.createSession();
    await chat.send(s2.id, 'Kya yaad hai mujhe?');
    expect(captured).not.toBeNull();
    const systemContents = captured!.messages.filter((m) => m.role === 'system').map((m) => m.content);
    expect(systemContents.join('\n')).toContain('Meri aim IIT ka preparation hai');
  });

  it('persists raw chats to memory without any model call', async () => {
    let completeCalls = 0;
    const repo = new MemoryChatRepository();
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    });
    const provider: LLMProvider = {
      id: 'openrouter',
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => {
        completeCalls += 1;
        throw new Error('model down');
      },
      stream: async (): Promise<LLMResponse> => ({ text: 'done', model: 'a' }),
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const memory = new MemoryService(new FakeClock());
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, memory, store);
    const s1 = chat.createSession();
    await chat.send(s1.id, 'Meri aim IIT hai');

    await expect(chat.summarizePriorChats()).resolves.toBe(1);

    const entries = store.get().memory.entries.filter((e) => e.type === 'conversation' && e.context.tags.includes(s1.id));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].content).toContain('Meri aim IIT hai');
    expect(repo.load().sessions.find((s) => s.id === s1.id)?.memorySummarizedAt).toBeDefined();
    // Raw storage is deterministic — the model is never consulted.
    expect(completeCalls).toBe(0);
  });

  it('retries a session whose memory write failed on the next run', async () => {
    const repo = new MemoryChatRepository();
    let state: AppState = {
      ...emptyAppState(),
      aiSettings: {
        ...emptyAppState().aiSettings,
        aiEnabled: true,
        providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      },
    };
    let writes = 0;
    const store: StateStore = {
      get: () => state,
      save: (s: AppState) => {
        writes += 1;
        if (writes === 1) throw new Error('storage full');
        state = s;
      },
    };
    const provider: LLMProvider = {
      id: 'openrouter',
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => ({ text: '', model: 'a' }),
      stream: async (): Promise<LLMResponse> => ({ text: 'done', model: 'a' }),
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const memory = new MemoryService(new FakeClock());
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, memory, store);
    const s1 = chat.createSession();
    await chat.send(s1.id, 'Meri aim IIT hai');

    // First run: the memory write fails, so the session must stay unmarked.
    await expect(chat.summarizePriorChats()).resolves.toBe(0);
    expect(repo.load().sessions.find((s) => s.id === s1.id)?.memorySummarizedAt).toBeUndefined();
    expect(store.get().memory.entries).toHaveLength(0);

    // Second run: retried and completed.
    await expect(chat.summarizePriorChats()).resolves.toBe(1);
    expect(repo.load().sessions.find((s) => s.id === s1.id)?.memorySummarizedAt).toBeDefined();
    const entries = store.get().memory.entries.filter((e) => e.context.tags.includes(s1.id));
    expect(entries.length).toBeGreaterThan(0);
  });

  it('still writes a transcript for a degenerate session', async () => {
    const { chat, store, repo } = buildService({ withMemory: true, replies: ['ok'] });
    const s1 = chat.createSession();
    await chat.send(s1.id, '   ');
    await chat.summarizePriorChats();
    const entries = store.get().memory.entries.filter((e) => e.context.tags.includes(s1.id));
    expect(entries.length).toBeGreaterThan(0);
    expect(repo.load().sessions.find((s) => s.id === s1.id)?.memorySummarizedAt).toBeDefined();
  });

  it('stores the raw transcript verbatim, including coach replies', async () => {
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
      stream: async (): Promise<LLMResponse> => ({ text: 'done', model: 'a' }),
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const memory = new MemoryService(new FakeClock());
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, memory, store);
    const s1 = chat.createSession();
    await chat.send(s1.id, 'Meri weak topic vectors aur limits hain, roz practice karni hai');
    await chat.send(s1.id, '### Problem:\n\nIs integral ka step-by-step solution do');
    await chat.send(s1.id, 'Hi');
    await chat.summarizePriorChats();

    const all = store
      .get()
      .memory.entries.filter((e) => e.context.tags.includes(s1.id))
      .map((e) => e.content)
      .join('\n');
    // Both sides of the chat land in memory untouched, in one transcript.
    expect(all).toContain('weak topic vectors');
    expect(all).toContain('step-by-step solution');
    expect(all).toContain('AI Coach');
    expect(all).toContain('### Problem:');
    expect(all).toContain('Student: Hi');
    // The AI reply right after the student line is kept together with it.
    expect(all).toMatch(/Student: Hi\nAI Coach: done/);
  });

  it('sends file attachments directly to the model as file parts', async () => {
    const restore = stubBlobUtils();
    try {
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
          return { text: 'file understood', model: 'a' };
        },
        fetchModels: async (): Promise<ModelInfo[]> => [],
        healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
      };
      const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
      const settings = new ProviderSettingsService(store, factory);
      const llm = new LLMService(factory, settings);
      const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, null, store);
      const s1 = chat.createSession();

      await chat.send(
        s1.id,
        'Analyze this PDF',
        undefined,
        undefined,
        undefined,
        undefined,
        [{ id: 'a1', name: 'doc.pdf', kind: 'file', previewUrl: 'blob:fake' }],
      );

      expect(captured).not.toBeNull();
      const lastUser = captured!.messages.filter((m) => m.role === 'user').pop()!;
      const parts = lastUser.content as ContentPart[];
      const filePart = parts.find((p) => p.type === 'file');
      expect(filePart).toBeDefined();
      if (filePart && filePart.type === 'file') {
        expect(filePart.file.filename).toBe('doc.pdf');
        expect(filePart.file.file_data).toContain('data:');
      }
    } finally {
      restore();
    }
  });

  it('falls back to extracted text when the direct file send fails', async () => {
    let calls = 0;
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
      stream: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) throw new ProviderError('openrouter', 'rate-limit', 'Rate limited or model down');
        return { text: 'extracted reply', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const chat = new ChatService(
      repo,
      llm,
      settings,
      () => 'ctx',
      new FakeClock(),
      null,
      null,
      store,
      async () => 'PDF extracted text content yahan hai',
    );
    const s1 = chat.createSession();

    const result = await chat.send(
      s1.id,
      'Analyze',
      undefined,
      undefined,
      undefined,
      undefined,
      [{ id: 'a1', name: 'doc.pdf', kind: 'file', previewUrl: 'blob:fake' }],
    );

    expect(calls).toBe(2);
    expect(result.content).toContain('extracted reply');
    const userMsg = repo.load().sessions[0].messages[0];
    expect(userMsg.content).toContain('PDF extracted text content yahan hai');
    expect(userMsg.attachments ?? []).toHaveLength(0);

    // A second file send in the same session goes straight to text.
    const again = await chat.send(
      s1.id,
      'one more',
      undefined,
      undefined,
      undefined,
      undefined,
      [{ id: 'a2', name: 'next.pdf', kind: 'file', previewUrl: 'blob:fake' }],
    );
    expect(again.content).toContain('extracted reply');
  });

  it('flushes the sanitizer tail so the final streamed chars are not lost', async () => {
    let captureDelta: ((d: string) => void) | null = null;
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
        captureDelta = req.onDelta ?? null;
        // "to" at a line start could grow into a "tool:" trace, so the
        // sanitizer holds it — flush() must release it once the stream ends.
        captureDelta?.('Done.\nto');
        return { text: 'Done.\nto', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, null, store);

    const deltas: string[] = [];
    const s1 = chat.createSession();
    await chat.send(s1.id, 'q', (d) => deltas.push(d));

    // Without the flush after the stream, the trailing "to" would be dropped.
    expect(deltas.join('')).toBe('Done.\nto');
  });

  it('doubles the max_tokens budget when thinking is on', async () => {
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
        return { text: 'ok', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, null, store);
    const s1 = chat.createSession();

    // Session-level thinking preference is on → budget doubles for headroom.
    s1.prefs = { ...s1.prefs, thinking: 'medium' };
    await chat.send(s1.id, 'q');
    expect(captured!.thinking).toBe('medium');
    expect(captured!.maxTokens).toBe(16384);

    // Thinking off → the user's own budget is used as-is.
    s1.prefs = { ...s1.prefs, thinking: 'off' };
    await chat.send(s1.id, 'q2');
    expect(captured!.maxTokens).toBe(8192);
  });

  it('does not extract/retry when a file send is aborted by the user', async () => {
    let calls = 0;
    let extracted = 0;
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
      stream: async (): Promise<LLMResponse> => {
        calls += 1;
        throw new ProviderError('openrouter', 'aborted', 'aborted by user');
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const chat = new ChatService(
      repo,
      llm,
      settings,
      () => 'ctx',
      new FakeClock(),
      null,
      null,
      store,
      async () => {
        extracted += 1;
        return 'never extracted';
      },
    );
    const s1 = chat.createSession();

    await expect(
      chat.send(
        s1.id,
        'Analyze',
        undefined,
        undefined,
        undefined,
        undefined,
        [{ id: 'a1', name: 'doc.pdf', kind: 'file', previewUrl: 'blob:fake' }],
      ),
    ).rejects.toBeInstanceOf(ProviderError);

    expect(calls).toBe(1);
    expect(extracted).toBe(0);
    // The user message is rolled back so no stray attachment mutation remains.
    expect(repo.load().sessions[0].messages).toHaveLength(0);
  });

  it('routes memory queries through the memory tool decision hop', async () => {
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    });
    const memory = new MemoryService(new FakeClock());
    const init = memory.add(store.get(), { type: 'goal', content: 'Aim: IIT Delhi, weak in Calculus', source: 'user', importance: 0.9 });
    store.save(init);

    let capturedComplete: LLMRequest | null = null;
    const provider: LLMProvider = {
      id: 'openrouter',
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        capturedComplete = req;
        return { text: '{"action":"readMemory"}', model: 'a' };
      },
      stream: async (): Promise<LLMResponse> => ({ text: '', model: 'a' }),
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const memoryTools = new MemoryToolsService(store, memory);
    const chat = new ChatService(new MemoryChatRepository(), llm, settings, () => 'ctx', new FakeClock(), null, memory, store, undefined, memoryTools);
    const s1 = chat.createSession();

    const result = await chat.send(s1.id, 'Tumhe kya yaad hai?');

    // The decision hop saw the memory tool instructions, and the executed
    // readMemory result became the assistant reply.
    const systemText = capturedComplete!.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    expect(systemText).toContain('readMemory');
    expect(result.content).toContain('IIT Delhi');
    expect(result.content).toContain('id:');
  });

  it('does not run the memory tool hop when AI memory is disabled', async () => {
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
      chat: { ...emptyAppState().aiSettings.chat, memoryEnabled: false },
    });
    const memory = new MemoryService(new FakeClock());
    let streamed = false;
    const provider: LLMProvider = {
      id: 'openrouter',
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => ({ text: '{"action":"readMemory"}', model: 'a' }),
      stream: async (): Promise<LLMResponse> => {
        streamed = true;
        return { text: 'normal reply', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const memoryTools = new MemoryToolsService(store, memory);
    const chat = new ChatService(new MemoryChatRepository(), llm, settings, () => 'ctx', new FakeClock(), null, memory, store, undefined, memoryTools);
    const s1 = chat.createSession();

    // Memory is off, so "kya yaad hai" is just a normal streamed question.
    await chat.send(s1.id, 'Tumhe kya yaad hai?');
    expect(streamed).toBe(true);
    expect(await chat.summarizePriorChats()).toBe(0);
    expect(chat.pendingSummaries()).toBe(0);
  });

  it('limits conversation history to the configured window', async () => {
    let captured: LLMRequest | null = null;
    const repo = new MemoryChatRepository();
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
      chat: { ...emptyAppState().aiSettings.chat, conversationHistoryLength: 2 },
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
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, null, store);
    const session = chat.createSession();
    await chat.send(session.id, 'pehla');
    await chat.send(session.id, 'doosra');
    await chat.send(session.id, 'teesra');
    const history = captured!.messages.filter((m) => m.role !== 'system');
    // Only the last two messages are sent (prev reply + current question).
    expect(history).toHaveLength(2);
    const joined = history.map((m) => String(m.content)).join('\n');
    expect(joined).toContain('teesra');
    expect(joined).not.toContain('pehla');
    expect(joined).not.toContain('doosra');
  });

  it('keeps new chats ephemeral when auto-save chats is off', () => {
    const repo = new MemoryChatRepository();
    const store = makeStore({
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
      chat: { ...emptyAppState().aiSettings.chat, autoSaveChats: false },
    });
    const provider: LLMProvider = {
      id: 'openrouter',
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => ({ text: '', model: 'a' }),
      stream: async (): Promise<LLMResponse> => ({ text: 'hi', model: 'a' }),
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
    const settings = new ProviderSettingsService(store, factory);
    const llm = new LLMService(factory, settings);
    const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, null, store);

    const s = chat.createSession();
    expect(chat.listSessions().map((x) => x.id)).toEqual([s.id]);
    // Nothing was written to the repository — a reload loses the session.
    expect(repo.load().sessions).toHaveLength(0);
  });

  it('applies global thinking to existing sessions', () => {
    const { chat } = buildService({});
    const s = chat.createSession();
    chat.applyGlobalPrefs({
      temperature: 0.4,
      maxTokens: 4096,
      systemPrompt: 'sys',
      userPersona: 'persona',
      includeContext: false,
      thinking: 'high',
    });
    expect(chat.getSession(s.id)?.prefs.thinking).toBe('high');
    expect(chat.getSession(s.id)?.prefs.maxTokens).toBe(4096);
  });
});

