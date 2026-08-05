import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { LEVELS, TOTAL_DAYS } from '../../../data/curriculum';
import type { ChatRepository, StateStore, StateRepository } from '../../../core/ports/repositories';
import type { ChatStoreState } from '../../../core/domain/chat';
import type { LLMProvider, LLMResponse, LLMRequest, HealthCheckResult, ModelInfo, ProviderId, ContentPart } from '../../../core/domain/llm';
import type { ProviderFactory } from '../../../infra/ai/provider-factory';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { HabitProgressionService } from '../../habit-engine/planner';
import { parseTaskBankEntry } from '../../task-bank/validation';
import { LLMService } from '../../ai/llm.service';
import { ProviderSettingsService } from '../../ai/provider-settings.service';
import { ChatService } from '../chat.service';
import { ChatToolsService } from '../chat-tools.service';
import { PlannerService, PlannerToolsService } from '../../planner/planner.service';
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
  return new ChatService(new MemoryChatRepository(), llm, settings, () => 'ctx', new FakeClock(), tools, null, store);
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

/** Stubs FileReader + fetch so blobToDataUrl resolves to a fake PDF data URL. */
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
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
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

describe('ChatToolsService', () => {
  it('detects task-related queries and parses valid tool actions', () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    expect(tools.isTaskQuery('kal ke tasks kya hain?')).toBe(true);
    expect(tools.isTaskQuery('day 30 ka plan batao')).toBe(true);
    // General concept questions stay on the normal chat path — they must NOT
    // consume a tool hop (this was the wrong-tool-pick bug).
    expect(tools.isTaskQuery('concept samjhao')).toBe(false);
    expect(tools.isTaskQuery('is problem ka solution batao')).toBe(false);
    expect(tools.isTaskQuery('physics kaise padhein')).toBe(false);
    // Custom-block commands still route to tools thanks to the block anchor.
    expect(tools.isTaskQuery('concept building block banao')).toBe(true);
    expect(tools.isTaskQuery('physics block create karo')).toBe(true);
    expect(tools.isTaskQuery('block-bogus ko extend karo')).toBe(true);
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

  it('getRange auto-chunks ranges wider than 7 days instead of failing', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const tooBig = await tools.run({ action: 'getRange', fromDay: 1, toDay: 30 });
    expect(tooBig.ok).toBe(true);
    expect(tooBig.summary).toContain('Plan overview Day 1-10');
    expect(tooBig.summary).toContain('Plan overview Day 11-20');
    expect(tooBig.summary).toContain('Day 30');
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

  it('markDone uses special plan log keys such as mock days', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    // Day 19 (2026-07-19) is an actual Sunday past the Day-15 gate → mock protocol active.
    const result = await tools.run({ action: 'markDone', day: 19, taskId: 'mock_1' });
    expect(result.ok).toBe(true);
    expect(store.get().taskLogs['mock:2026-07-19']?.mock_1).toBe(true);
    expect(store.get().taskLogs['2026-07-19']?.mock_1).toBeUndefined();
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
    // Use a late-unlock seed task so it is NOT already scheduled on Day 4 (the
    // duplicate guard must not block this legitimate clone).
    taskGeneration.generate = async () => ({ entry: buildSeed().tasks.find((t) => t.id === 'd11_t1')!, source: 'bank' });
    const result = await tools.run({ action: 'addTask', day: 4, intent: 'existing bank task', durationMin: 20 });
    expect(result.ok).toBe(true);
    const added = store.get().dynamicTaskBank[0];
    expect(added.id).toMatch(/^ai-/);
    expect(added.legacy).toBeUndefined();
    expect(added.unlockConditions).toEqual([{ type: 'day-exact', day: 4 }]);
  });

  it('addTask schedules the task only for that exact day', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    await tools.run({ action: 'addTask', day: 5, intent: 'chat se task', durationMin: 20 });
    const day5 = store.get().dynamicTaskBank.find((e) => e.id === 'ai-chat-test');
    expect(day5?.unlockConditions).toEqual([{ type: 'day-exact', day: 5 }]);
    const planDay5 = tools.run({ action: 'getPlan', day: 5 });
    const planDay6 = tools.run({ action: 'getPlan', day: 6 });
    expect((await planDay5).summary).toContain('Chat se add hua task');
    expect((await planDay6).summary).not.toContain('Chat se add hua task');
  });

  it('addTask applies provided full metadata and exposes it in the plan', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    await tools.run({
      action: 'addTask',
      day: 5,
      intent: 'chat se task',
      durationMin: 45,
      description: 'Custom thermodynamics practice',
      difficulty: 4,
      energyLevel: 'high',
      tags: ['physics', 'thermo'],
      taskType: 'Advanced',
      revisionSuitability: 0.7,
      backlogSuitability: 0.3,
      thinkingSkills: ['analysis', 'verification'],
      jeeRelevance: { subject: 'physics', score: 0.9 },
    });
    const entry = store.get().dynamicTaskBank.find((e) => e.id === 'ai-chat-test');
    expect(entry?.description).toBe('Custom thermodynamics practice');
    expect(entry?.difficulty).toBe(4);
    expect(entry?.energyLevel).toBe('high');
    expect(entry?.tags).toEqual(['physics', 'thermo']);
    expect(entry?.taskType).toBe('Advanced');
    expect(entry?.thinkingSkills).toEqual(['analysis', 'verification']);
    const plan = await tools.run({ action: 'getPlan', day: 5 });
    expect(plan.summary).toContain('difficulty:4/5');
    expect(plan.summary).toContain('subject:physics');
  });

  it('editTask fails without any concrete edit field so the AI can retry with full info', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({ action: 'editTask', day: 1, taskId: 'd1_t1' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('edit ke liye');
    expect(result.missingTaskIdDays).toEqual([1]);
  });

  it('creates and activates blocks while updating post-journey extension days', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({
      action: 'createBlock',
      name: 'Physics Mastery',
      description: 'Thermo and mechanics focus',
      days: 12,
      focusAreas: ['physics'],
      difficulty: 'hard',
    });
    expect(result.ok).toBe(true);
    const block = store.get().postJourney.customPhases[0];
    expect(block.name).toBe('Physics Mastery');
    expect(block.description).toBe('Thermo and mechanics focus');
    expect(block.dayStart).toBe(91);
    expect(block.dayEnd).toBe(102);
    expect(store.get().postJourney.activeCustomPhaseId).toBe(block.id);
    expect(store.get().postJourney.extensionDays).toBe(12);
    expect(store.get().postJourney.journeyComplete).toBe(true);
  });

  it('edits, extends, lists, and deletes active blocks safely', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    await tools.run({ action: 'createBlock', name: 'Physics Block', days: 7, focusAreas: ['physics'], difficulty: 'medium' });
    const blockId = store.get().postJourney.customPhases[0].id;

    const edit = await tools.run({ action: 'editBlock', blockId, name: 'Hard Physics Block', days: 10, habits: ['HCV drills'], goals: ['Finish mechanics'], difficulty: 'hard' });
    expect(edit.ok).toBe(true);
    expect(store.get().postJourney.customPhases[0]).toMatchObject({ name: 'Hard Physics Block', dayStart: 91, dayEnd: 100, difficulty: 'hard' });

    const extend = await tools.run({ action: 'extendBlock', blockId, days: 5 });
    expect(extend.ok).toBe(true);
    expect(store.get().postJourney.customPhases[0].dayEnd).toBe(105);
    expect(store.get().postJourney.extensionDays).toBe(15);

    const list = await tools.run({ action: 'listBlocks' });
    expect(list.summary).toContain(blockId);
    expect(list.summary).toContain('Hard Physics Block');

    const preview = await tools.run({ action: 'deleteBlock', blockId });
    expect(preview.requiresConfirmation).toBe(true);
    const deleted = await tools.run({ action: 'deleteBlock', blockId, confirmed: true });
    expect(deleted.ok).toBe(true);
    expect(store.get().postJourney.customPhases).toHaveLength(0);
    expect(store.get().postJourney.activeCustomPhaseId).toBeNull();
    expect(store.get().postJourney.extensionDays).toBe(0);
  });

  it('removeTask hides a built-in task for one day only; the bank entry is untouched', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const preview = await tools.run({ action: 'removeTask', day: 1, taskId: 'd1_t1' });
    expect(preview.ok).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(store.get().dynamicTaskBank.some((e) => e.id === 'd1_t1')).toBe(false);

    const result = await tools.run({ action: 'removeTask', day: 1, taskId: 'd1_t1', confirmed: true });
    expect(result.ok).toBe(true);
    const override = store.get().dynamicTaskBank.find((e) => e.id === 'd1_t1');
    expect(override?.active).toBe(true);
    expect(override?.unlockConditions).toEqual([{ type: 'day', fromDay: 1 }, { type: 'not-day', day: 1 }]);
    // The bank seed is still present (never deleted).
    expect(buildSeed().tasks.some((t) => t.id === 'd1_t1')).toBe(true);
    // Gone from day 1, still planned on day 2.
    expect((await tools.run({ action: 'getPlan', day: 1 })).summary).not.toContain('id:d1_t1');
    expect((await tools.run({ action: 'getPlan', day: 2 })).summary).toContain('id:d1_t1');
  });

  it('removeTask deletes an explicitly scheduled dynamic task for that day', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    await tools.run({ action: 'addTask', day: 3, intent: 'chat se task', durationMin: 20 });
    expect(store.get().dynamicTaskBank.some((e) => e.id === 'ai-chat-test')).toBe(true);
    const result = await tools.run({ action: 'removeTask', day: 3, taskId: 'ai-chat-test', confirmed: true });
    expect(result.ok).toBe(true);
    expect(store.get().dynamicTaskBank.some((e) => e.id === 'ai-chat-test')).toBe(false);
  });

  it('bulkRemoveTasks removes multiple built-in tasks from one day only', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.run({ action: 'bulkRemoveTasks', day: 1, taskIds: ['d1_t1', 'd1_t2'], confirmed: true });
    expect(result.ok).toBe(true);
    const overrides = store.get().dynamicTaskBank.filter((e) => e.unlockConditions.some((c) => c.type === 'not-day' && c.day === 1));
    expect(overrides.length).toBe(2);
    const day1 = await tools.run({ action: 'getPlan', day: 1 });
    expect(day1.summary).not.toContain('id:d1_t1');
    expect(day1.summary).not.toContain('id:d1_t2');
    const day2 = await tools.run({ action: 'getPlan', day: 2 });
    expect(day2.summary).toContain('id:d1_t1');
    expect(day2.summary).toContain('id:d1_t2');
  });

  it('setDayMode rest empties the plan and study restores it', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const rest = await tools.run({ action: 'setDayMode', day: 2, mode: 'rest' });
    expect(rest.ok).toBe(true);
    expect(store.get().restDays).toEqual([2]);
    const restPlan = await tools.run({ action: 'getPlan', day: 2 });
    expect(restPlan.summary).toContain('REST DAY');
    expect(restPlan.summary).not.toContain('id:d');
    const study = await tools.run({ action: 'setDayMode', day: 2, mode: 'study' });
    expect(study.ok).toBe(true);
    expect(store.get().restDays).toEqual([]);
    const studyPlan = await tools.run({ action: 'getPlan', day: 2 });
    expect(studyPlan.summary).toContain('id:d1_t');
  });

  it('can add tasks on a mock Sunday and they appear in that plan', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    // Day 19 (2026-07-19) is an actual Sunday past the Day-15 gate → mock protocol active.
    const sunday = await tools.run({ action: 'getPlan', day: 19 });
    expect(sunday.summary).toContain('id:mock_1');
    const add = await tools.run({ action: 'addTask', day: 19, intent: 'sunday revision', durationMin: 20 });
    expect(add.ok).toBe(true);
    const updated = await tools.run({ action: 'getPlan', day: 19 });
    expect(updated.summary).toContain('Chat se add hua task');
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
    expect(override?.unlockConditions).toEqual([{ type: 'day-exact', day: 2 }]);
  });

  it('reports missingTaskIdDays when an action targets an unknown task id', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const edit = await tools.run({ action: 'editTask', day: 1, taskId: 'nope', durationMin: 25 });
    expect(edit.ok).toBe(false);
    expect(edit.missingTaskIdDays).toEqual([1]);
    const mark = await tools.run({ action: 'markDone', day: 2, taskId: 'nope' });
    expect(mark.ok).toBe(false);
    expect(mark.missingTaskIdDays).toEqual([2]);
    const remove = await tools.run({ action: 'removeTask', day: 3, taskId: 'nope', confirmed: true });
    expect(remove.ok).toBe(false);
    expect(remove.missingTaskIdDays).toEqual([3]);
  });

  it('bulkAddTasks keeps the tasks that generated when one intent fails', async () => {
    const store = makeStore();
    const { tools, taskGeneration } = makeTools(store);
    taskGeneration.generate = async (_state, input) => {
      if (input.intent === 'bogus') throw new Error('generate failed');
      return {
        entry: parseTaskBankEntry({
          id: `ai-${input.intent}`,
          habitId: 'h1',
          title: input.intent,
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
      };
    };
    const result = await tools.run({ action: 'bulkAddTasks', day: 3, intents: ['pehla', 'bogus', 'dusra'], durationMin: 20 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Added 3 task(s)');
    expect(result.summary).toContain('local fallback se add kar diye');
    const ids = store.get().dynamicTaskBank.map((e) => e.id);
    expect(ids).toContain('ai-pehla');
    expect(ids).toContain('ai-dusra');
    expect(store.get().dynamicTaskBank.map((e) => e.title)).toContain('bogus');
  });

  it('bulkAddTasks falls back to local tasks when every AI intent fails', async () => {
    const store = makeStore();
    const { tools, taskGeneration } = makeTools(store);
    taskGeneration.generate = async () => {
      throw new Error('generate failed');
    };
    const result = await tools.run({ action: 'bulkAddTasks', day: 3, intents: ['a', 'b'], durationMin: 20 });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Added 2 task(s)');
    expect(store.get().dynamicTaskBank.map((t) => t.title)).toEqual(['a', 'b']);
  });

  it('accepts and runs up to 100 tool actions in one batch', async () => {
    const store = makeStore();
    const { tools, taskGeneration } = makeTools(store);
    taskGeneration.generate = async (_state, input) => ({
      entry: parseTaskBankEntry({
        id: `ai-${input.intent}`,
        habitId: 'h1',
        title: input.intent,
        description: 'added via chat tool',
        phase: 'jee-core',
        difficulty: 2,
        estimatedDurationMin: input.durationMin ?? 20,
        energyLevel: 'low',
        tags: [],
        prerequisites: [],
        taskType: 'Beginner',
        revisionSuitability: 0.2,
        backlogSuitability: 0.2,
        thinkingSkills: ['recall'],
        jeeRelevance: { subject: 'physics', score: 0.5 },
        unlockConditions: [{ type: 'day-exact', day: input.dayNumber ?? 1 }],
        active: true,
      }),
      source: 'ai',
    });
    const actions = Array.from({ length: 100 }, (_, i) => ({ action: 'addTask' as const, day: 3, intent: `task-${i}`, durationMin: 20 }));
    const result = await tools.runMany(actions);
    expect(result.ok).toBe(true);
    expect(store.get().dynamicTaskBank).toHaveLength(100);
  });

  it('parses 100-action wrappers without dropping valid actions', () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const actions = Array.from({ length: 100 }, (_, i) => ({ action: 'addTask', day: 3, intent: `task-${i}`, durationMin: 20 }));
    expect(tools.parseTools(JSON.stringify({ actions }))).toHaveLength(100);
    expect(tools.parseTools(JSON.stringify(actions))).toHaveLength(100);
  });

  it('smoke-tests task bank view/edit/delete tools end-to-end', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);

    const add = await tools.run({ action: 'addTask', day: 4, intent: 'chemistry revision dummy', durationMin: 25, tags: ['chemistry'] });
    expect(add.ok).toBe(true);
    const taskId = store.get().dynamicTaskBank[0].id;

    const allTasks = await tools.run({ action: 'getAllTasks', day: 4 });
    expect(allTasks.ok).toBe(true);
    expect(allTasks.summary).toContain(taskId);

    const bank = await tools.run({ action: 'getTaskBank', category: 'chemistry' });
    expect(bank.ok).toBe(true);
    expect(bank.summary).toContain(taskId);

    const edit = await tools.run({ action: 'editAnyTask', taskId, title: 'Updated chemistry revision', durationMin: 35, category: 'revision' });
    expect(edit.ok).toBe(true);
    expect(store.get().dynamicTaskBank[0]).toMatchObject({ title: 'Updated chemistry revision', estimatedDurationMin: 35 });

    const preview = await tools.run({ action: 'deleteAnyTask', taskId });
    expect(preview.requiresConfirmation).toBe(true);
    expect(store.get().dynamicTaskBank).toHaveLength(1);

    const deleted = await tools.run({ action: 'deleteAnyTask', taskId, confirmed: true });
    expect(deleted.ok).toBe(true);
    expect(store.get().dynamicTaskBank).toHaveLength(0);
  });

  it('routes uploaded-planner questions to the SAME tools hop and runs getTests/getSubject/getRoutine', async () => {
    const store = makeStore();
    const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
    const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
    const taskBank = new TaskBankServiceImpl(taskBankRepo);
    const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
    const taskGeneration = { generate: async () => ({ entry: null as never, source: 'ai' as const }) } as unknown as TaskGenerationService;

    const plannerService = new PlannerService(store);
    plannerService.importPlanners(
      JSON.stringify({
        version: 2,
        type: 'levelup-subject-planner',
        planners: [
          { kind: 'test', subject: 'Full Test Schedule', title: 'JEE 2027 Tests', tests: [
            { name: 'Short Test-1', date: '2026-07-10', testType: 'Part Test', pattern: 'JEE Advanced', syllabus: { Physics: ['Electrostatic Potential'], Chemistry: ['Mole Concept'], Maths: ['Matrices (Complete Chapter)'] } },
            { name: 'JEE Main-1', date: '2026-07-28', testType: 'Full Syllabus', pattern: 'JEE Main', syllabus: { Physics: ['Electrostatics of Conductor'] } },
          ] },
          { kind: 'routine', subject: 'Class Timetable', title: 'Lakshya Weekly Routine', routine: [
            { day: 'Monday', slots: [{ time: '06:00 PM - 07:30 PM', activity: 'Physics' }, { time: '08:00 PM - 09:00 PM', activity: 'Maths' }] },
            { day: 'Tuesday', slots: [{ time: '06:00 PM - 07:30 PM', activity: 'Chemistry' }] },
          ] },
        ],
      }),
    );
    const plannerTools = new PlannerToolsService(store, plannerService);
    const tools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, plannerTools);

    expect(tools.hasPlannerData()).toBe(true);
    // Planner schedule questions reach the same decision gate as task queries.
    expect(tools.isTaskQuery('tests dekho')).toBe(true);
    expect(tools.isTaskQuery('kal koi test hai kya')).toBe(true);
    expect(tools.isTaskQuery('routine batao')).toBe(true);
    expect(tools.isTaskQuery('monday ko kya class hai')).toBe(true);
    expect(tools.isTaskQuery('physics mein kya kya hai')).toBe(true);
    expect(tools.isTaskQuery('concept samjhao')).toBe(false);

    const tests = await tools.run({ action: 'getTests', from: '2026-07-01', to: '2026-07-15' });
    expect(tests.ok).toBe(true);
    expect(tests.summary).toContain('Short Test-1');
    expect(tests.summary).not.toContain('JEE Main-1');

    const routine = await tools.run({ action: 'getRoutine', day: 'Monday' });
    expect(routine.ok).toBe(true);
    expect(routine.summary).toContain('Physics');

    const subject = await tools.run({ action: 'getSubject', subject: 'Physics' });
    expect(subject.ok).toBe(true);
    expect(subject.summary).toContain('Short Test-1');
    expect(subject.summary).toContain('JEE Main-1');

    const missing = await tools.run({ action: 'getTests', from: '2026-09-01', to: '2026-09-30' });
    expect(missing.ok).toBe(false);
    expect(missing.retryable).toBe(true);
  });

  it('resolves unambiguous planner questions deterministically (no LLM needed)', async () => {
    const store = makeStore();
    const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
    const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
    const taskBank = new TaskBankServiceImpl(taskBankRepo);
    const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
    const taskGeneration = { generate: async () => ({ entry: null as never, source: 'ai' as const }) } as unknown as TaskGenerationService;

    const plannerService = new PlannerService(store);
    plannerService.importPlanners(
      JSON.stringify({
        version: 2,
        type: 'levelup-subject-planner',
        planners: [
          { kind: 'routine', subject: 'Class Timetable', title: 'Lakshya Weekly Routine', routine: [
            { day: 'Friday', slots: [{ time: '04:00 PM - 05:45 PM', activity: 'Physics' }, { time: '06:15 PM - 08:00 PM', activity: 'Maths' }] },
          ] },
          { kind: 'test', subject: 'Full Test Schedule', title: 'JEE 2027 Tests', tests: [
            { name: 'Short Test-1', date: '2026-07-10', testType: 'Part Test', pattern: 'JEE Advanced', syllabus: { Physics: ['Electrostatic Potential'] } },
          ] },
          { kind: 'subject', subject: 'Physics', title: 'Class 11 Physics', items: [{ title: 'Kinematics', type: 'chapter', week: 1 }] },
        ],
      }),
    );
    const plannerTools = new PlannerToolsService(store, plannerService);
    const tools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, plannerTools);
    const today = '2026-08-05';

    expect(tools.plannerActionFor('friday ka schedule batao', today)).toEqual({ action: 'getRoutine', day: 'Friday' });
    expect(tools.plannerActionFor('routine batao', today)).toEqual({ action: 'getRoutine' });
    expect(tools.plannerActionFor('kal koi test hai kya', today)).toEqual({ action: 'getTests', from: '2026-08-06', to: '2026-08-06' });
    expect(tools.plannerActionFor('physics mein kya kya hai', today)).toEqual({ action: 'getSubject', subject: 'Physics' });
    // A guessed subject that is NOT in the data falls back to the LLM hop.
    expect(tools.plannerActionFor('biology mein kya kya hai', today)).toBeNull();
    expect(tools.plannerActionFor('concept samjhao', today)).toBeNull();
  });

  it('resolves whole-journey overview questions deterministically to getContext', () => {
    const store = makeStore();
    const { tools } = makeTools(store);

    expect(tools.contextActionFor('mera progress kya hai')).toEqual({ action: 'getContext' });
    expect(tools.contextActionFor('status batao')).toEqual({ action: 'getContext' });
    expect(tools.contextActionFor('context batao')).toEqual({ action: 'getContext' });
    expect(tools.contextActionFor('mera streak kitna hai')).toEqual({ action: 'getContext' });
    expect(tools.contextActionFor('journey ka overview de do')).toEqual({ action: 'getContext' });
    // Explicit plan/test/subject anchors stay on the normal LLM decision hop.
    expect(tools.contextActionFor('day 5 ka summary batao')).toBeNull();
    expect(tools.contextActionFor('aaj ka plan kya hai')).toBeNull();
    expect(tools.contextActionFor('physics revision samjhao')).toBeNull();
    expect(tools.contextActionFor('')).toBeNull();
  });

  it('getContext returns the full journey snapshot deterministically', async () => {
    const store = makeStore();
    const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
    const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
    const taskBank = new TaskBankServiceImpl(taskBankRepo);
    const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
    const taskGeneration = { generate: async () => ({ entry: null as never, source: 'ai' as const }) } as unknown as TaskGenerationService;
    const now = { now: () => new Date('2026-07-31T10:00:00Z') };
    const tools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, null, now);

    const result = await tools.run({ action: 'getContext' });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('2026-07-31');
    expect(result.summary).toContain('Journey Day');
    expect(result.summary).toContain('Today\'s scheduled tasks');
    expect(result.summary).toContain('Journey so far');
  });

  it('runs a mixed bulk batch: planner tools AND task tools in ONE call', async () => {
    const store = makeStore();
    const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
    const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
    const taskBank = new TaskBankServiceImpl(taskBankRepo);
    const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
    const taskGeneration = {
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

    const plannerService = new PlannerService(store);
    plannerService.importPlanners(
      JSON.stringify({
        version: 2,
        type: 'levelup-subject-planner',
        planners: [
          { kind: 'routine', subject: 'Class Timetable', title: 'Weekly Routine', routine: [
            { day: 'Monday', slots: [{ time: '04:00 PM - 05:45 PM', activity: 'Physics' }] },
          ] },
          { kind: 'test', subject: 'Full Test Schedule', title: 'Tests', tests: [
            { name: 'Short Test-1', date: '2026-07-10', testType: 'Part Test', pattern: 'JEE Advanced', syllabus: { Physics: ['Electrostatic Potential'] } },
          ] },
        ],
      }),
    );
    const plannerTools = new PlannerToolsService(store, plannerService);
    const tools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, plannerTools);

    const result = await tools.runMany([
      { action: 'getRoutine', day: 'Monday' },
      { action: 'getTests' },
      { action: 'addTask', day: 3, intent: 'mixed batch physics revision', durationMin: 30 },
    ]);

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results?.map((r) => r.action)).toEqual(['getRoutine', 'getTests', 'addTask']);
    expect(result.results?.every((r) => r.ok)).toBe(true);
    expect(result.summary).toContain('Physics');
    expect(result.summary).toContain('Short Test-1');
    expect(result.summary).toContain('Chat se add hua task');
    expect(store.get().dynamicTaskBank).toHaveLength(1);
  });

  it('does not route planner questions to a separate hop when no planner data exists', () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    expect(tools.hasPlannerData()).toBe(false);
    expect(tools.isTaskQuery('physics mein kya kya hai')).toBe(false);
    expect(tools.isTaskQuery('concept samjhao')).toBe(false);
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

  it('runs getRoutine deterministically for "friday ka schedule batao" even when the model is broken', async () => {
    const store = makeStore();
    const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
    const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
    const taskBank = new TaskBankServiceImpl(taskBankRepo);
    const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
    const taskGeneration = { generate: async () => ({ entry: null as never, source: 'ai' as const }) } as unknown as TaskGenerationService;
    const plannerService = new PlannerService(store);
    plannerService.importPlanners(
      JSON.stringify({
        version: 2,
        type: 'levelup-subject-planner',
        planners: [
          { kind: 'routine', subject: 'Class Timetable', title: 'Weekly Routine', routine: [
            { day: 'Friday', slots: [{ time: '04:00 PM - 05:45 PM', activity: 'Physics' }, { time: '06:15 PM - 08:00 PM', activity: 'Maths' }] },
          ] },
        ],
      }),
    );
    const plannerTools = new PlannerToolsService(store, plannerService);
    const tools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, plannerTools);

    let completeCalled = false;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      // A broken model: decision hop would return prose, not JSON.
      complete: async (): Promise<LLMResponse> => {
        completeCalled = true;
        return { text: 'Main aapko Friday ka plan bata deta hoon.', model: 'a' };
      },
      stream: async (_req: LLMRequest): Promise<LLMResponse> => {
        return { text: 'Friday ka class schedule: 04:00-05:45 Physics, 06:15-08:00 Maths.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();

    const reply = await chat.send(session.id, 'friday ka schedule batao');

    // The deterministic fast path never asked the LLM for a decision.
    expect(completeCalled).toBe(false);
    expect(reply.tool).toBe('getRoutine');
    expect(reply.toolCalls?.[0]).toMatchObject({ action: 'getRoutine', ok: true });
    expect(reply.content).toContain('Physics');
    expect(reply.content).not.toContain('"action"');
  });

  it('runs getContext deterministically for "mera progress kya hai" even when the model is broken', async () => {
    const store = makeStore();
    const stateRepo: StateRepository = { load: () => store.get(), save: (s) => store.save(s), clear: () => undefined };
    const taskBankRepo = new TaskBankRepositoryImpl(stateRepo, buildSeed());
    const taskBank = new TaskBankServiceImpl(taskBankRepo);
    const planner = new HabitProgressionService({ taskBank, habits: taskBankRepo, levels: LEVELS, totalDays: TOTAL_DAYS });
    const taskGeneration = { generate: async () => ({ entry: null as never, source: 'ai' as const }) } as unknown as TaskGenerationService;
    const now = { now: () => new Date('2026-07-31T10:00:00Z') };
    const tools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, null, now);

    let completeCalled = false;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      // A broken model: decision hop would return prose, not JSON.
      complete: async (): Promise<LLMResponse> => {
        completeCalled = true;
        return { text: 'Main aapko progress bata deta hoon.', model: 'a' };
      },
      stream: async (_req: LLMRequest): Promise<LLMResponse> => {
        return { text: 'Aapki journey Day 30 par hai.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();

    const reply = await chat.send(session.id, 'mera progress kya hai');

    // The deterministic fast path never asked the LLM for a decision.
    expect(completeCalled).toBe(false);
    expect(reply.tool).toBe('getContext');
    expect(reply.toolCalls?.[0]).toMatchObject({ action: 'getContext', ok: true });
    expect(reply.content).toContain('Day 30');
    expect(reply.content).not.toContain('"action"');
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

  it('executes Python-style tool calls from a Python-trained model and never leaks them', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      // A Python/agent-trained model answers the decision hop with print() calls.
      complete: async (): Promise<LLMResponse> => ({
        text: 'print(addTask(day=3, intent="physics revision", durationMin=40))',
        model: 'a',
      }),
      stream: async (_req: LLMRequest): Promise<LLMResponse> => {
        return { text: 'Day 3 mein physics revision add ho gaya.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();

    const reply = await chat.send(session.id, 'day 3 mein physics revision add karo');

    expect(reply.tool).toBe('addTask');
    expect(reply.toolCalls?.[0]).toMatchObject({ action: 'addTask', ok: true });
    // The action really ran...
    expect(store.get().dynamicTaskBank.some((t) => t.id === 'ai-chat-test')).toBe(true);
    // ...and the print() call never reached the user.
    expect(reply.content).toContain('add ho gaya');
    expect(reply.content).not.toContain('print(');
    expect(reply.content).not.toContain('removeTask');
    expect(reply.content).not.toContain('"action"');
  });

  it('sends file attachments straight to the model — skips the tool decision hop', async () => {
    const restore = stubBlobUtils();
    try {
      const store = makeStore();
      const { tools } = makeTools(store);
      let completeCalled = false;
      let streamCalled = false;
      let lastRequest: LLMRequest | null = null;
      const provider: LLMProvider = {
        id: 'openrouter' as ProviderId,
        label: 'OpenRouter',
        isConfigured: () => true,
        complete: async (): Promise<LLMResponse> => {
          completeCalled = true;
          return { text: '', model: 'a' };
        },
        stream: async (req: LLMRequest): Promise<LLMResponse> => {
          streamCalled = true;
          lastRequest = req;
          return { text: 'PDF ka analysis:', model: 'a' };
        },
        fetchModels: async (): Promise<ModelInfo[]> => [],
        healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
      };
      const chat = makeChat(store, provider, tools);
      const session = chat.createSession();
      // "concept" is a TASK_QUERY_WORD — without the routing fix this message
      // would hit the JSON tool decision hop (complete) instead of the real
      // chat completion (stream), and a PDF could never reach the model.
      const reply = await chat.send(
        session.id,
        'Is PDF ka concept samjhao',
        undefined,
        undefined,
        undefined,
        undefined,
        [{ id: 'a1', name: 'notes.pdf', kind: 'file', previewUrl: 'blob:fake-pdf' }],
      );
      expect(completeCalled).toBe(false);
      expect(streamCalled).toBe(true);
      expect(reply.content).toBe('PDF ka analysis:');
      const lastUser = lastRequest!.messages.filter((m) => m.role === 'user').pop()!;
      const parts = lastUser.content as ContentPart[];
      expect(parts.some((p) => p.type === 'file')).toBe(true);
    } finally {
      restore();
    }
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
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls?.[0]).toMatchObject({ action: 'removeTask', ok: true });
    expect(typeof reply.toolCalls?.[0]?.message).toBe('string');
  });

  it('auto-fetches the day plan and replans when the model guesses a wrong task id', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    let calls = 0;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) return { text: '{"action":"editTask","day":1,"taskId":"d1_bogus","durationMin":25}', model: 'a' };
        return { text: '{"action":"editTask","day":1,"taskId":"d1_t1","durationMin":25}', model: 'a' };
      },
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        req.onDelta?.('Edit kar diya.');
        return { text: 'Edit kar diya.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'day 1 ka pehla task 25 min ka kar do');
    expect(calls).toBe(2);
    expect(reply.content).toBe('Edit kar diya.');
    const override = store.get().dynamicTaskBank.find((e) => e.id === 'd1_t1');
    expect(override?.estimatedDurationMin).toBe(25);
  });

  it('keeps partial non-destructive mutations when the replan also fails', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    let calls = 0;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) return { text: '{"actions":[{"action":"addTask","day":3,"intent":"pehla","durationMin":20},{"action":"editTask","day":3,"taskId":"bad","durationMin":25}]}', model: 'a' };
        return { text: 'koi tool nahi, bas prose', model: 'a' };
      },
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        req.onDelta?.('Nahi ho paya.');
        return { text: 'Nahi ho paya.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'day 3 mein task add karo aur edit karo');
    expect(calls).toBe(2);
    expect(reply.content).toBe('Nahi ho paya.');
    // The addTask that succeeded before the guessed-id failure stays applied.
    expect(store.get().dynamicTaskBank.some((e) => e.id === 'ai-chat-test')).toBe(true);
  });

  it('feeds a retryable non-id tool error back so the model can fix and re-emit', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    let calls = 0;
    let sawErrorFeedback = false;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) return { text: '{"action":"editBlock","blockId":"block-bogus","days":5}', model: 'a' };
        const lastUser = req.messages.filter((m) => m.role === 'user').pop();
        const content = typeof lastUser?.content === 'string' ? lastUser.content : '';
        if (content.includes('Failed actions and errors')) sawErrorFeedback = true;
        return { text: '{"action":"listBlocks"}', model: 'a' };
      },
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        req.onDelta?.('Dekh rahe hain.');
        return { text: 'Dekh rahe hain.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'block-bogus ko 5 din extend karo');
    expect(calls).toBe(2);
    expect(sawErrorFeedback).toBe(true);
    expect(reply.content).toBe('Dekh rahe hain.');
    expect(reply.tool).toBe('listBlocks');
  });

  it('stops retrying when the error-feedback hop also fails to emit JSON', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    let calls = 0;
    const provider: LLMProvider = {
      id: 'openrouter' as ProviderId,
      label: 'OpenRouter',
      isConfigured: () => true,
      complete: async (): Promise<LLMResponse> => {
        calls += 1;
        if (calls === 1) return { text: '{"action":"editBlock","blockId":"block-bogus","days":5}', model: 'a' };
        return { text: 'mujhe nahi pata, prose hi bhej raha hoon', model: 'a' };
      },
      stream: async (req: LLMRequest): Promise<LLMResponse> => {
        req.onDelta?.('Nahi ho paya.');
        return { text: 'Nahi ho paya.', model: 'a' };
      },
      fetchModels: async (): Promise<ModelInfo[]> => [],
      healthCheck: async (): Promise<HealthCheckResult> => ({ ok: true, provider: 'openrouter', latencyMs: 1 }),
    };
    const chat = makeChat(store, provider, tools);
    const session = chat.createSession();
    const reply = await chat.send(session.id, 'block-bogus ko 5 din extend karo');
    expect(calls).toBe(2);
    expect(reply.content).toBe('Nahi ho paya.');
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
    session.prefs = { ...session.prefs, model: 'custom-tool-model', thinking: 'high' };
    const statuses: string[] = [];
    await chat.send(session.id, 'day 2 ka plan kya hai?', undefined, undefined, (s) => statuses.push(s));
    expect(statuses.join(' | ')).toContain('AI soch raha hai');
    expect(statuses.join(' | ')).toContain('getPlan');
    expect(statuses.join(' | ')).toContain('Jawab likh raha hai');
    // Decision hops stay deterministic JSON (thinking off); only the streamed
    // summary carries the chat's thinking level.
    expect(requests[0].model).toBe('custom-tool-model');
    expect(requests[0].thinking).toBe('off');
    expect(requests[1].thinking).toBe('high');
  });

  it('parseTools accepts a batch wrapper, a bare array and prose-wrapped json', () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    expect(
      tools.parseTools(
        '{"actions":[{"action":"addTask","day":5,"intent":"maths","durationMin":30},{"action":"removeTask","day":5,"taskId":"d1_t1","confirmed":true}]}',
      ),
    ).toEqual([
      { action: 'addTask', day: 5, intent: 'maths', durationMin: 30 },
      { action: 'removeTask', day: 5, taskId: 'd1_t1', confirmed: true },
    ]);
    expect(tools.parseTools('[{"action":"markDone","day":3,"taskId":"d1_t2"}]')).toEqual([
      { action: 'markDone', day: 3, taskId: 'd1_t2' },
    ]);
    expect(tools.parseTools('ok so {"actions":[{"action":"getPlan","day":9}]} done')).toEqual([
      { action: 'getPlan', day: 9 },
    ]);
    expect(tools.parseTools('{"actions":[{"action":"addTask","day":5,"intent":"maths"},{"action":"removeTask","day":5,"taskId":"d1_t1","confirmed":true}]}')).toEqual([]);
    expect(tools.parseTools('koi json nahi')).toEqual([]);
  });

  it('parseTools converts Python-style tool calls into real actions', () => {
    const store = makeStore();
    const { tools } = makeTools(store);

    expect(
      tools.parseTools(
        'print(removeTask(task_id="d1_t3", day_id="Day 1"))\nprint(removeTask(task_id="d1_t4", day_id="Day 1"))',
      ),
    ).toEqual([
      { action: 'removeTask', day: 1, taskId: 'd1_t3' },
      { action: 'removeTask', day: 1, taskId: 'd1_t4' },
    ]);

    expect(tools.parseTools('removeTask(day=5, task_id="d1_t1", confirmed=True)')).toEqual([
      { action: 'removeTask', day: 5, taskId: 'd1_t1', confirmed: true },
    ]);

    expect(tools.parseTools('bulkAddTasks(day_id="Day 2", intents=["maths 10 questions","thermo revision"], duration_min=30)')).toEqual([
      { action: 'bulkAddTasks', day: 2, intents: ['maths 10 questions', 'thermo revision'], durationMin: 30 },
    ]);

    expect(tools.parseTools('addTask(day=3, intent="physics revision", durationMin=40)')).toEqual([
      { action: 'addTask', day: 3, intent: 'physics revision', durationMin: 40 },
    ]);

    expect(tools.parseTools('getRoutine(day="Monday")')).toEqual([{ action: 'getRoutine', day: 'Monday' }]);
    expect(tools.parseTools('getTests(from="2026-07-01", to="2026-07-31")')).toEqual([
      { action: 'getTests', from: '2026-07-01', to: '2026-07-31' },
    ]);
    expect(tools.parseTools('getContext()')).toEqual([{ action: 'getContext' }]);
    // Unknown/unsupported calls are ignored, not mis-executed.
    expect(tools.parseTools('print(unknownTool(x=1))')).toEqual([]);
  });

  it('runs Python-style tool calls from a broken model as a real batch', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);

    const result = await tools.runMany(
      tools.parseTools('print(addTask(day=3, intent="python call add", durationMin=25))'),
    );

    expect(result.ok).toBe(true);
    // The makeTools stub generates a fixed entry title, but the action itself ran.
    expect(store.get().dynamicTaskBank.some((t) => t.id === 'ai-chat-test')).toBe(true);
  });

  it('runMany applies several actions in order on fresh state', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.runMany([
      { action: 'addTask', day: 3, intent: 'pehla task', durationMin: 20 },
      { action: 'addTask', day: 3, intent: 'dusra task', durationMin: 20 },
      { action: 'markDone', day: 1, taskId: 'd1_t1' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Day 3');
    const planDay3 = await tools.run({ action: 'getPlan', day: 3 });
    expect(planDay3.summary).toContain('ai-chat-test');
    const log = store.get().taskLogs['2026-07-03'] ?? store.get().taskLogs['2026-07-01'];
    expect(Object.values(log).some(Boolean)).toBe(true);
  });

  it('runMany previews the WHOLE batch when a destructive action lacks confirmation', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const before = store.get().taskLogs;
    const result = await tools.runMany([
      { action: 'addTask', day: 4, intent: 'add hona chahiye', durationMin: 20 },
      { action: 'removeTask', day: 1, taskId: 'd1_t1' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.summary).toContain('Preview');
    // Nothing applied: the addTask in the same batch must NOT have run.
    const planDay4 = await tools.run({ action: 'getPlan', day: 4 });
    expect(planDay4.summary).not.toContain('ai-chat-test');
    expect(store.get().taskLogs).toEqual(before);
  });

  it('runMany applies destructive actions once confirmed', async () => {
    const store = makeStore();
    const { tools } = makeTools(store);
    const result = await tools.runMany([
      { action: 'setDayMode', day: 2, mode: 'rest', confirmed: true },
      { action: 'bulkMarkDone', day: 1, taskIds: ['d1_t1', 'd1_t2'], confirmed: true },
    ]);
    expect(result.ok).toBe(true);
    const restPlan = await tools.run({ action: 'getPlan', day: 2 });
    expect(restPlan.summary).toContain('REST');
    const log = store.get().taskLogs['2026-07-01'];
    expect(log['d1_t1']).toBe(true);
    expect(log['d1_t2']).toBe(true);
  });
});
