// Regression: the "Tool Decisions" settings — toolThinking + toolMaxTokens —
// flow into every tool DECISION hop request (task tools, planner, memory,
// retries all share the same budget). Defaults stay 'off'/1024 so the fast
// deterministic JSON path is preserved unless the user opts in from
// Chat Settings > Tool Decisions.
//
// The "Memory summary" settings — memorySummaryThinking/maxTokens/prompt —
// flow into the background AI memory summary request (defaults medium/8000/
// built-in instructions) from Chat Settings > Memory & Context.
import { describe, it, expect } from 'vitest';
import { ChatService } from '../../../features/chat/chat.service';
import { ChatToolsService } from '../../../features/chat/chat-tools.service';
import { LLMService } from '../../../features/ai/llm.service';
import { ProviderSettingsService } from '../../../features/ai/provider-settings.service';
import { MemoryService } from '../../../features/ai/memory.service';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import { defaultChatPrefs } from '../../../core/domain/chat';
import type { ChatStoreState } from '../../../core/domain/chat';
import type { ChatRepository, StateStore, StateRepository } from '../../../core/ports/repositories';
import type { LLMProvider, LLMResponse, LLMRequest, HealthCheckResult, ModelInfo, ProviderId } from '../../../core/domain/llm';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { HabitProgressionService } from '../../habit-engine/planner';
import { parseTaskBankEntry } from '../../task-bank/validation';
import { LEVELS, TOTAL_DAYS } from '../../../data/curriculum';
import type { TaskGenerationService } from '../../ai/task-generation.service';

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

function makeStore(chatOverrides?: Partial<AppState['aiSettings']['chat']>): StateStore {
  let state: AppState = {
    ...emptyAppState(),
    aiSettings: {
      ...emptyAppState().aiSettings,
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
      chat: { ...emptyAppState().aiSettings.chat, ...chatOverrides },
    },
  };
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

function makeTools(store: StateStore): ChatToolsService {
  const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
  const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
  const taskBank = new TaskBankServiceImpl(taskBankRepo);
  const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
  const taskGeneration: TaskGenerationService = {
    generate: async () => ({
      entry: parseTaskBankEntry({
        id: 'ai-chat-test',
        habitId: 'h1',
        title: 'Chat se add hua task',
        description: 'added via chat tool',
        phase: 'jee-core',
        difficulty: 2,
        estimatedDurationMin: 20,
        energyLevel: 'low',
        tags: [],
        prerequisites: [],
        taskType: 'Beginner',
        revisionSuitability: 0.2,
        backlogSuitability: 0.2,
        thinkingSkills: ['recall'],
        jeeRelevance: { subject: 'physics', score: 0.5 },
        unlockConditions: [{ type: 'day', fromDay: 1 }],
        active: true,
      }),
      source: 'ai',
    }),
  } as unknown as TaskGenerationService;
  return new ChatToolsService(store, planner, taskBank, taskGeneration);
}

/** Decision hop uses `complete` (compact JSON); the summary uses `stream`. */
function decisionProvider(onDecision?: (req: LLMRequest) => void): LLMProvider {
  const id: ProviderId = 'openrouter';
  return {
    id,
    label: 'OpenRouter',
    isConfigured: () => true,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      onDecision?.(req);
      return { text: '{"actions":[{"action":"getPlan","day":1}]}', model: id };
    },
    stream: async (): Promise<LLMResponse> => ({ text: 'Yeh raha Day 1 ka plan.', model: id }),
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: id, latencyMs: 1 }),
  };
}

function build(store: StateStore, provider: LLMProvider): { chat: ChatService } {
  const repo = new MemoryChatRepository();
  const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
  const settings = new ProviderSettingsService(store, factory);
  const llm = new LLMService(factory, settings);
  const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), makeTools(store), null, store);
  return { chat };
}

/** Memory summary uses `complete` too; returns one valid JSON block so the
 *  run succeeds and marks the session aiSummarizedAt. */
function memoryProvider(onSummary?: (req: LLMRequest) => void): LLMProvider {
  const id: ProviderId = 'openrouter';
  return {
    id,
    label: 'OpenRouter',
    isConfigured: () => true,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      onSummary?.(req);
      return {
        text: '{"blocks":[{"title":"Test","lines":["ek fact"],"longTerm":false,"tags":[]}]}',
        model: id,
      };
    },
    stream: async (): Promise<LLMResponse> => ({ text: 'Haan batao.', model: id }),
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: id, latencyMs: 1 }),
  };
}

function buildWithMemory(store: StateStore, provider: LLMProvider): { chat: ChatService } {
  const repo = new MemoryChatRepository();
  const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
  const settings = new ProviderSettingsService(store, factory);
  const llm = new LLMService(factory, settings);
  const memory = new MemoryService(new FakeClock());
  const chat = new ChatService(repo, llm, settings, () => 'ctx', new FakeClock(), null, memory, store);
  return { chat };
}

describe('tool decision settings end-to-end', () => {
  it('defaults: decision hop stays thinking off with a 1024 token budget', async () => {
    let decision: LLMRequest | null = null;
    const store = makeStore();
    const { chat } = build(store, decisionProvider((req) => (decision = req)));
    const s = chat.createSession('q', defaultChatPrefs());
    await chat.send(s.id, 'aaj ke tasks kya hain?');
    expect(decision).not.toBeNull();
    expect(decision!.thinking).toBe('off');
    expect(decision!.maxTokens).toBe(1024);
  });

  it('configured: toolThinking + toolMaxTokens apply to the decision hop', async () => {
    let decision: LLMRequest | null = null;
    const store = makeStore({ toolThinking: 'medium', toolMaxTokens: 2048 });
    const { chat } = build(store, decisionProvider((req) => (decision = req)));
    const s = chat.createSession('q', defaultChatPrefs());
    await chat.send(s.id, 'aaj ke tasks kya hain?');
    expect(decision).not.toBeNull();
    expect(decision!.thinking).toBe('medium');
    // With thinking ON the output window doubles so reasoning tokens cannot
    // crowd out the JSON batch (same rule as chat replies).
    expect(decision!.maxTokens).toBe(4096);
  });
});

describe('memory summary settings end-to-end', () => {
  it('defaults: memory summary runs with medium thinking and an 8000 token budget', async () => {
    let summary: LLMRequest | null = null;
    const store = makeStore();
    const { chat } = buildWithMemory(store, memoryProvider((req) => (summary = req)));
    const s1 = chat.createSession('q', defaultChatPrefs());
    await chat.send(s1.id, 'Hi');
    const result = await chat.summarizeAllMemoryWithAi();
    expect(result.count).toBe(1);
    expect(result.blocks).toBe(1);
    expect(summary).not.toBeNull();
    expect(summary!.thinking).toBe('medium');
    expect(summary!.maxTokens).toBe(8000);
    // Default prompt is the built-in instructions.
    expect(summary!.messages[0].content).toContain('memory curator');
  });

  it('configured: user overrides for thinking + tokens reach the summary request', async () => {
    let summary: LLMRequest | null = null;
    const store = makeStore({ memorySummaryThinking: 'off', memorySummaryMaxTokens: 12000 });
    const { chat } = buildWithMemory(store, memoryProvider((req) => (summary = req)));
    const s1 = chat.createSession('q', defaultChatPrefs());
    await chat.send(s1.id, 'Hi');
    await chat.summarizeAllMemoryWithAi();
    expect(summary).not.toBeNull();
    expect(summary!.thinking).toBe('off');
    expect(summary!.maxTokens).toBe(12000);
  });

  it('configured: a custom memory summary prompt replaces the built-in instructions', async () => {
    let summary: LLMRequest | null = null;
    const custom = 'Tum ek strict Hindi summarizer ho. Sirf 3 blocks banao.';
    const store = makeStore({ memorySummaryPrompt: custom });
    const { chat } = buildWithMemory(store, memoryProvider((req) => (summary = req)));
    const s1 = chat.createSession('q', defaultChatPrefs());
    await chat.send(s1.id, 'Hi');
    await chat.summarizeAllMemoryWithAi();
    expect(summary).not.toBeNull();
    expect(summary!.messages[0].content).toBe(custom);
    expect(summary!.messages[0].content).not.toContain('memory curator');
  });
});
