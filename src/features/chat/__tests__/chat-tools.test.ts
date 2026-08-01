import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { LEVELS, TOTAL_DAYS } from '../../../data/curriculum';
import type { ChatRepository, StateStore, StateRepository } from '../../../core/ports/repositories';
import type { ChatStoreState } from '../../../core/domain/chat';
import type { LLMProvider, LLMResponse, LLMRequest, HealthCheckResult, ModelInfo, ProviderId } from '../../../core/domain/llm';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { HabitProgressionService } from '../../habit-engine/planner';
import { parseTaskBankEntry } from '../../task-bank/validation';
import { LLMService } from '../../ai/llm.service';
import { ProviderSettingsService } from '../../ai/provider-settings.service';
import { ChatService } from '../chat.service';
import { ChatToolsService } from '../chat-tools.service';
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

function makeStore(): StateStore {
  let state: AppState = {
    ...emptyAppState(),
    startDateISO: '2026-07-01',
    aiSettings: {
      ...emptyAppState().aiSettings,
      providers: { openrouter: { id: 'openrouter', label: 'OpenRouter', model: 'a', enabled: true } },
      aiEnabled: true,
    },
  };
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

function makeTools(store: StateStore): { tools: ChatToolsService; taskGeneration: TaskGenerationService } {
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
  return { tools: new ChatToolsService(store, planner, taskBank, taskGeneration), taskGeneration };
}

function makeChat(store: StateStore, provider: LLMProvider, tools: ChatToolsService): ChatService {
  const factory: ProviderFactory = { create: () => provider } as unknown as ProviderFactory;
  const settings = new ProviderSettingsService(store, factory);
  const llm = new LLMService(factory, settings);
  return new ChatService(new MemoryChatRepository(), llm, settings, () => 'ctx', new FakeClock(), tools);
}

function providerWith(completeText: string, streamText: string): LLMProvider {
  return {
    id: 'openrouter' as ProviderId,
    label: 'OpenRouter',
    isConfigured: () => true,
    complete: async (): Promise<LLMResponse> => ({ text: completeText, model: 'a' }),
    stream: async (req: LLMRequest): Promise<LLMResponse> => {
      if (req.onDelta) req.onDelta(streamText);
      return { text: streamText, model: 'a' };
    },
    fetchModels: async (): Promise<ModelInfo[]> => [],
    healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
  };
}

describe('ChatToolsService', () => {
  it('detects task-related queries and parses valid tool actions', () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    expect(tools.isTaskQuery('kal ke tasks kya hain?')).toBe(true);
    expect(tools.isTaskQuery('day 30 ka plan batao')).toBe(true);
    expect(tools.isTaskQuery('concept samjhao')).toBe(false);
    expect(tools.parseTool('{"action":"getPlan","day":15}')).toEqual({ action: 'getPlan', day: 15 });
    expect(tools.parseTool('sure! {"action":"markDone","day":2,"taskId":"x"} ok')).toEqual({ action: 'markDone', day: 2, taskId: 'x' });
    expect(tools.parseTool('no json here')).toBeNull();
    expect(tools.parseTool('{"action":"hack"}')).toBeNull();
  });

  it('getPlan returns the deterministic plan for any day with ids', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({ action: 'getPlan', day: 1 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Day 1 plan');
    expect(result.summary).toContain('id:d1_t1');
    expect(result.summary).toContain('[todo]');
  });

  it('getRange clamps to a bounded window', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const tooBig = await tools.run({ action: 'getRange', fromDay: 1, toDay: 30 });
    expect(tooBig.ok).toBe(false);
    const ok = await tools.run({ action: 'getRange', fromDay: 60, toDay: 62 });
    expect(ok.ok).toBe(true);
    expect(ok.summary).toContain('Day 60');
  });

  it('markDone persists through the store', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({ action: 'markDone', day: 1, taskId: 'd1_t1' });
    expect(result.ok).toBe(true);
    expect(store.get().taskLogs['2026-07-01']?.['d1_t1']).toBe(true);
  });

  it('addTask appends a dynamic entry through the store', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({ action: 'addTask', day: 3, intent: 'chat se task', durationMin: 20 });
    expect(result.ok).toBe(true);
    expect(store.get().dynamicTaskBank.some((e) => e.id === 'ai-chat-test')).toBe(true);
  });



  it('addTask clones bank matches into editable dynamic tasks', async () => {
    const store = makeStore();
    const { tools, taskGeneration } = makeTools(store);
    taskGeneration.generate = async () => ({ entry: buildSeed().tasks[0], source: 'bank' });
    const result = await tools.run({ action: 'addTask', day: 4, intent: 'existing bank task', durationMin: 20 });
    expect(result.ok).toBe(true);
    const added = store.get().dynamicTaskBank[0];
    expect(added.id).toMatch(/^ai-/);
    expect(added.legacy).toBeUndefined();
    expect(added.unlockConditions).toEqual([{ type: 'day', fromDay: 4 }]);
  });

  it('removeTask can disable built-in seed entries and remove dynamic entries', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const preview = await tools.run({ action: 'removeTask', day: 1, taskId: 'd1_t1' });
    expect(preview.ok).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(store.get().dynamicTaskBank.find((e) => e.id === 'd1_t1')).toBeUndefined();
    const seedResult = await tools.run({ action: 'removeTask', day: 1, taskId: 'd1_t1', confirmed: true });
    expect(seedResult.ok).toBe(true);
    expect(store.get().dynamicTaskBank.find((e) => e.id === 'd1_t1')?.active).toBe(false);
    store.save({ ...store.get(), dynamicTaskBank: [parseTaskBankEntry({
      id: 'ai-xyz', habitId: 'h1', title: 'temp', description: '', phase: 'jee-core', difficulty: 1,
      estimatedDurationMin: 10, energyLevel: 'low', tags: [], prerequisites: [], taskType: 'Beginner',
      revisionSuitability: 0.1, backlogSuitability: 0.1, thinkingSkills: ['recall'],
      jeeRelevance: { score: 0.1 }, unlockConditions: [{ type: 'day', fromDay: 1 }], active: true,
    })] });
    const result = await tools.run({ action: 'removeTask', day: 1, taskId: 'ai-xyz', confirmed: true });
    expect(result.ok).toBe(true);
    expect(store.get().dynamicTaskBank.some((e) => e.id === 'ai-xyz')).toBe(false);
  });

  it('bulkMarkDone previews and then marks all visible day tasks together', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const preview = await tools.run({ action: 'bulkMarkDone', day: 1 });
    expect(preview.ok).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(store.get().taskLogs['2026-07-01']).toBeUndefined();

    const result = await tools.run({ action: 'bulkMarkDone', day: 1, confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.versionId).toBeTruthy();
    expect(Object.values(store.get().taskLogs['2026-07-01'] ?? {}).every(Boolean)).toBe(true);
  });

  it('editTask can override a built-in seed entry', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({ action: 'editTask', day: 1, taskId: 'd1_t1', title: 'Updated built-in task', durationMin: 25, dayTo: 2 });
    expect(result.ok).toBe(true);
    const override = store.get().dynamicTaskBank.find((e) => e.id === 'd1_t1');
    expect(override?.title).toBe('Updated built-in task');
    expect(override?.estimatedDurationMin).toBe(25);
    expect(override?.unlockConditions).toEqual([{ type: 'day', fromDay: 2 }]);
  });
});

describe('ChatService with tools', () => {
  it('executes a tool action and streams a Hinglish summary', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const provider = providerWith('{"action":"markDone","day":1,"taskId":"d1_t1"}', 'Ho gaya! Day 1 ka d1_t1 done mark.');
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'day 1 ka pehla task mark karo');
    expect(reply.content).toBe('Ho gaya! Day 1 ka d1_t1 done mark.');
    expect(store.get().taskLogs['2026-07-01']?.['d1_t1']).toBe(true);
  });

  it('delivers a normal answer directly when the model does not emit a tool action', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    let streamCalled = false;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => ({ text: 'Plan bata deta hoon: konse din kya karna hai.', model: 'a' }),
      stream: async (_req: LLMRequest): Promise<LLMResponse> => {
        streamCalled = true;
        return { text: 'nope', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'mere tasks kya hain?');
    expect(reply.content).toContain('konse din');
    expect(streamCalled).toBe(false);
  });
});

describe('ChatService tool retry + reasoning', () => {
  it('retries the decision hop once when the model refuses with prose', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    let calls = 0;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) return { text: 'Main tasks delete nahi kar sakta. Skip karke chalo.', model: 'a' };
        return { text: '{"action":"removeTask","day":1,"taskId":"d1_t1","confirmed":true}', model: 'a' };
      },
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        req.onDelta?.('Hata diya.');
        return { text: 'Hata diya.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'aaj ka d1_t1 task delete karo');
    expect(calls).toBe(2);
    expect(reply.content).toBe('Hata diya.');
    expect(reply.tool).toBe('removeTask');
  });

  it('captures reasoning on the assistant message and forwards deltas', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => ({ text: '{"action":"getPlan","day":1}', model: 'a' }),
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        req.onReasoningDelta?.('pehle soch raha hoon...');
        req.onDelta?.('Day 1 ka plan 4 tasks ka hai.');
        return { text: 'Day 1 ka plan 4 tasks ka hai.', model: 'a', reasoning: 'pehle soch raha hoon...' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const seenReasoning: string[] = [];
    const reply = await chat.send(
      session.id,
      'day 1 ka plan batao',
      undefined,
      undefined,
      undefined,
      (d) => seenReasoning.push(d),
    );
    expect(reply.reasoning).toBe('pehle soch raha hoon...');
    expect(seenReasoning.join('')).toBe('pehle soch raha hoon...');
  });

  it('reports status while executing tools and passes thinking level', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const requests: LLMRequest[] = [];
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        return { text: '{"action":"getPlan","day":2}', model: 'a' };
      },
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        req.onDelta?.('day 2 ka plan.');
        return { text: 'day 2 ka plan.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    session.prefs = { ...session.prefs, thinking: 'high' };
    const statuses: string[] = [];
    await chat.send(session.id, 'day 2 ka plan kya hai?', undefined, undefined, (s) => statuses.push(s));
    expect(statuses.join(' | ')).toContain('AI soch raha hai');
    expect(statuses.join(' | ')).toContain('getPlan');
    expect(statuses.join(' | ')).toContain('Jawab likh raha hai');
    // Decision hops stay deterministic JSON (thinking off); only the streamed
    // summary carries the chat's thinking level.
    expect(requests[0].thinking).toBe('off');
    expect(requests[1].thinking).toBe('high');
  });
});
