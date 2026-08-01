import { describe, it, expect, vi } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { TaskGenerationService } from '../task-generation.service';
import { parseTaskBankEntry } from '../../task-bank/validation';
import type { TaskBankService } from '../../task-bank/task-bank.service';
import type { HabitRepository } from '../../../core/ports/repositories';
import type { LLMService } from '../llm.service';
import type { LLMRequest, LLMResponse } from '../../../core/domain/llm';
import type { TaskBankEntry } from '../../../core/domain/task-bank';

function bankEntry(overrides: Partial<TaskBankEntry> = {}): TaskBankEntry {
  return parseTaskBankEntry({
    id: 'ai-test',
    habitId: 'h1',
    title: 'Thermo ke 3 revision problems',
    description: 'Revision of thermodynamics laws',
    phase: 'jee-core',
    difficulty: 3,
    estimatedDurationMin: 30,
    energyLevel: 'medium',
    tags: ['physics', 'revision'],
    prerequisites: [],
    taskType: 'Review',
    revisionSuitability: 0.8,
    backlogSuitability: 0.2,
    thinkingSkills: ['analysis'],
    jeeRelevance: { subject: 'physics', score: 0.7 },
    unlockConditions: [{ type: 'day', fromDay: 1 }],
    active: true,
    ...overrides,
  });
}

function makeBank(searchResult: TaskBankEntry[]): TaskBankService {
  return {
    getAll: () => searchResult,
    getById: () => undefined,
    search: () => searchResult,
    findByLevel: () => [],
    findBySlot: () => [],
    saveDynamicEntry: () => undefined,
  };
}

function makeHabits(): HabitRepository {
  return {
    getAllHabits: () => [],
    getHabitById: () => undefined,
    getHabitsByLevel: () => [],
  };
}

function makeLLM(text: string): LLMService {
  return {
    complete: async (_req: LLMRequest): Promise<LLMResponse> => ({ text, model: 'm' }),
    stream: async (_req: LLMRequest): Promise<LLMResponse> => ({ text, model: 'm' }),
  } as unknown as LLMService;
}

function makeState(): AppState {
  return { ...emptyAppState(), startDateISO: '2026-07-01', dynamicTaskBank: [] };
}

describe('TaskGenerationService', () => {
  it('returns a bank match without calling the LLM', async () => {
    const entry = bankEntry({ id: 'bank-1' });
    const llm = vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({ text: 'must not be called', model: 'm' }));
    const svc = new TaskGenerationService(
      { complete: llm, stream: llm } as unknown as LLMService,
      makeBank([entry]),
      makeHabits(),
    );
    const result = await svc.generate(makeState(), { intent: 'thermo revision problems' });
    expect(result.source).toBe('bank');
    expect(result.entry.id).toBe('bank-1');
    expect(llm).not.toHaveBeenCalled();
  });

  it('asks the LLM and persists a validated ai- task when nothing matches the bank', async () => {
    const llm = makeLLM(
      JSON.stringify({
        habitId: 'h1',
        title: 'Rotational motion ke 2 numericals',
        description: 'Practice torque and angular momentum',
        phase: 'jee-core',
        difficulty: 4,
        estimatedDurationMin: 45,
        energyLevel: 'high',
        tags: ['physics', 'numericals'],
        prerequisites: [],
        taskType: 'Challenge',
        revisionSuitability: 0.5,
        backlogSuitability: 0.4,
        thinkingSkills: ['reasoning'],
        jeeRelevance: { subject: 'physics', score: 0.9 },
      }),
    );
    const svc = new TaskGenerationService(llm, makeBank([]), makeHabits());
    const result = await svc.generate(makeState(), { intent: 'rotational motion numericals', dayNumber: 1 });
    expect(result.source).toBe('ai');
    expect(result.entry.id.startsWith('ai-')).toBe(true);
    expect(result.entry.title).toBe('Rotational motion ke 2 numericals');
    expect(result.entry.unlockConditions).toEqual([{ type: 'day', fromDay: 1 }]);
  });

  it('extracts JSON from a markdown-wrapped reply', async () => {
    const llm = makeLLM(
      'Here you go:\n```json\n{"habitId":"h1","title":"Trigonometry identities","description":"Derive 5 identities","phase":"jee-core","difficulty":2,"estimatedDurationMin":20,"energyLevel":"low","tags":["maths"],"prerequisites":[],"taskType":"Beginner","revisionSuitability":0.3,"backlogSuitability":0.3,"thinkingSkills":["recall"],"jeeRelevance":{"subject":"maths","score":0.6}}\n```\n',
    );
    const svc = new TaskGenerationService(llm, makeBank([]), makeHabits());
    const result = await svc.generate(makeState(), { intent: 'trig identities' });
    expect(result.source).toBe('ai');
    expect(result.entry.title).toBe('Trigonometry identities');
  });

  it('surfaces a validation error when AI output is not usable', async () => {
    const llm = makeLLM('sorry, no JSON here');
    const svc = new TaskGenerationService(llm, makeBank([]), makeHabits());
    await expect(svc.generate(makeState(), { intent: 'some task' })).rejects.toThrow(/no JSON/);
  });

  it('retries once with a strict correction when the first reply is prose', async () => {
    const json = JSON.stringify({
      habitId: 'h1',
      title: 'Electrostatics revision',
      description: 'Cover Gauss + potential',
      phase: 'jee-core',
      difficulty: 2,
      estimatedDurationMin: 25,
      energyLevel: 'low',
      tags: ['physics'],
      prerequisites: [],
      taskType: 'Review',
      revisionSuitability: 0.7,
      backlogSuitability: 0.3,
      thinkingSkills: ['recall'],
      jeeRelevance: { subject: 'physics', score: 0.8 },
    });
    const calls: LLMRequest[] = [];
    const llm = {
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        calls.push(req);
        return { text: calls.length === 1 ? 'Main khud tasks nahi bana sakta, sorry.' : json, model: 'm' };
      },
      stream: async (_req: LLMRequest): Promise<LLMResponse> => ({ text: '', model: 'm' }),
    } as unknown as LLMService;
    const svc = new TaskGenerationService(llm, makeBank([]), makeHabits());
    const result = await svc.generate(makeState(), { intent: 'electrostatics revision' });
    expect(calls).toHaveLength(2);
    const secondCall = calls[1];
    expect(secondCall.messages.some((m) => {
      const content = typeof m.content === 'string' ? m.content : '';
      return content.includes('ONLY the JSON object now');
    })).toBe(true);
    expect(calls.every((r) => r.thinking === 'off')).toBe(true);
    expect(result.source).toBe('ai');
    expect(result.entry.title).toBe('Electrostatics revision');
  });

  it('enforces the per-day AI task cap', async () => {
    const state = makeState();
    state.dynamicTaskBank = [bankEntry({ id: 'ai-1' }), bankEntry({ id: 'ai-2' }), bankEntry({ id: 'ai-3' }), bankEntry({ id: 'ai-4' }), bankEntry({ id: 'ai-5' })];
    const llm = makeLLM('{}');
    const svc = new TaskGenerationService(llm, makeBank([]), makeHabits());
    await expect(svc.generate(state, { intent: 'one more task' })).rejects.toThrow(/5 AI tasks/);
  });

  it('passes dayNumber through to the unlock condition', async () => {
    const llm = makeLLM(
      JSON.stringify({
        habitId: 'h1',
        title: 'Kinematics questions',
        description: '10 one-liners',
        phase: 'jee-core',
        difficulty: 2,
        estimatedDurationMin: 15,
        energyLevel: 'low',
        tags: ['physics'],
        prerequisites: [],
        taskType: 'Beginner',
        revisionSuitability: 0.2,
        backlogSuitability: 0.2,
        thinkingSkills: ['recall'],
        jeeRelevance: { subject: 'physics', score: 0.5 },
      }),
    );
    const svc = new TaskGenerationService(llm, makeBank([]), makeHabits());
    const result = await svc.generate(makeState(), { intent: 'kinematics', dayNumber: 42 });
    expect(result.source).toBe('ai');
    expect(result.entry.unlockConditions).toEqual([{ type: 'day', fromDay: 42 }]);
  });
});
