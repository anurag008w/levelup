import { describe, it, expect } from 'vitest';
import { emptyAppState, type AppState, type CustomPhase } from '../../../core/domain/state';
import type { TaskBankEntry } from '../../../core/domain/task-bank';
import type { Habit } from '../../../core/domain/habit';
import { CURRICULUM_KIND, serializeCurriculum, parseCurriculum, applyCurriculum } from '../curriculum';

function task(overrides: Partial<TaskBankEntry> = {}): TaskBankEntry {
  return {
    id: 't1',
    habitId: 'h1',
    title: 'Solve 10 numericals',
    description: '',
    phase: 'jee-core',
    difficulty: 2,
    estimatedDurationMin: 30,
    energyLevel: 'medium',
    tags: [],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.3,
    backlogSuitability: 0.3,
    thinkingSkills: ['focus'],
    jeeRelevance: { score: 0.5 },
    unlockConditions: [{ type: 'day-exact', day: 10 }],
    active: true,
    ...overrides,
  };
}

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Formula Revision',
    description: 'Daily formulas',
    timeRequired: '15 min',
    criteria: 'Ek baar formulas revise kiye',
    phase: 'jee-core',
    levelId: 1,
    dayStart: 1,
    prerequisites: [],
    isCore: true,
    thinkingSkills: ['recall'],
    active: true,
    ...overrides,
  };
}

describe('curriculum import/export', () => {
  it('serializes a curriculum payload with kind + version + data', () => {
    const json = serializeCurriculum([task()], [habit()], []);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(CURRICULUM_KIND);
    expect(parsed.version).toBe(1);
    expect(parsed.data.tasks).toHaveLength(1);
    expect(parsed.data.habits).toHaveLength(1);
    expect(parsed.data.blocks).toEqual([]);
  });

  it('round-trips tasks, habits and blocks through parse', () => {
    const block = {
      id: 'b1',
      name: 'Physics Deep-Dive',
      description: 'Mechanics focus',
      dayStart: 91,
      dayEnd: 105,
      goals: ['Mechanics mastery'],
      habits: ['HCV Reading'],
      difficulty: 'medium' as const,
      createdBy: 'user' as const,
      createdAt: '2026-08-02T00:00:00.000Z',
    };
    const json = serializeCurriculum([task()], [habit()], [block]);
    const report = parseCurriculum(json);
    expect(report.tasks).toEqual([task()]);
    expect(report.habits).toEqual([habit()]);
    expect(report.blocks).toEqual([block]);
    expect(report.invalidTasks).toBe(0);
    expect(report.invalidHabits).toBe(0);
    expect(report.invalidBlocks).toBe(0);
  });

  it('round-trips blocks with nested levels (block = levels container)', () => {
    const block = {
      id: 'b1',
      name: 'Physics Sprint',
      description: 'Mechanics focus',
      dayStart: 91,
      dayEnd: 105,
      goals: ['Mechanics mastery'],
      habits: ['HCV Reading'],
      difficulty: 'medium' as const,
      createdBy: 'user' as const,
      createdAt: '2026-08-02T00:00:00.000Z',
      levels: [
        { id: 'lv-1', title: 'Physics Sprint — Part 1', dayStart: 91, dayEnd: 96, goals: ['Kinematics'], habits: ['Formula sheet'] },
        { id: 'lv-2', title: 'Physics Sprint — Part 2', dayStart: 97, dayEnd: 105, goals: ['Laws of Motion'], habits: ['PYQs'] },
      ],
    };
    const report = parseCurriculum(serializeCurriculum([], [], [block]));
    expect(report.blocks).toHaveLength(1);
    expect(report.blocks[0].levels).toHaveLength(2);
    expect(report.blocks[0].levels?.[1].dayEnd).toBe(105);

    // Apply keeps the nested levels intact.
    const { state: next } = applyCurriculum(emptyAppState(), report);
    expect(next.postJourney.customPhases[0].levels?.[0].title).toBe('Physics Sprint — Part 1');
  });

  it('rejects a block whose nested level is malformed', () => {
    const json = JSON.stringify({
      kind: CURRICULUM_KIND,
      version: 1,
      exportedAt: 'x',
      data: {
        tasks: [],
        habits: [],
        blocks: [
          {
            id: 'b1',
            name: 'Broken Block',
            description: '',
            dayStart: 91,
            dayEnd: 100,
            goals: [],
            habits: [],
            difficulty: 'easy',
            createdBy: 'user',
            createdAt: 'x',
            levels: [{ id: 'lv-1', title: '', dayStart: 91 }], // title empty + dayEnd missing
          },
        ],
      },
    });
    const report = parseCurriculum(json);
    expect(report.blocks).toHaveLength(0);
    expect(report.invalidBlocks).toBe(1);
  });

  it('throws a friendly error for invalid JSON', () => {
    expect(() => parseCurriculum('{not json')).toThrow(/valid JSON nahi/);
  });

  it('repairs a malformed task/habit row instead of dropping it (only fully unusable rows count as invalid)', () => {
    const json = JSON.stringify({
      kind: CURRICULUM_KIND,
      version: 1,
      exportedAt: 'x',
      data: {
        // { id: 'bad' } / { id: 'worse' } are missing almost every required
        // field — strict parsing rejects them, but they're still usable
        // objects, so the coercion fallback repairs them with safe
        // defaults instead of throwing the whole row away.
        tasks: [task(), { id: 'bad' }, 'not an object', null],
        habits: [habit(), { id: 'worse' }, 42],
        blocks: [{ id: 'b', name: 42 }],
      },
    });
    const report = parseCurriculum(json);
    expect(report.tasks).toHaveLength(2);
    expect(report.tasks[1].title).toBe('Imported task');
    expect(report.tasks[1].unlockConditions).toEqual([{ type: 'day', fromDay: 1 }]);
    expect(report.habits).toHaveLength(2);
    expect(report.habits[1].name).toBe('Imported habit');
    expect(report.blocks).toHaveLength(0);
    // Only the two genuinely non-object entries ('not an object', null, 42) are uncountable.
    expect(report.invalidTasks).toBe(2);
    expect(report.invalidHabits).toBe(1);
    expect(report.invalidBlocks).toBe(1);
  });

  it('drops thinking-skills that are not on the fixed enum instead of rejecting the whole row', () => {
    const json = JSON.stringify({
      kind: CURRICULUM_KIND,
      version: 1,
      exportedAt: 'x',
      data: {
        tasks: [{ ...task(), thinkingSkills: ['focus', 'made-up-skill', 'FOCUS'] }],
        habits: [],
        blocks: [],
      },
    });
    const report = parseCurriculum(json);
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0].thinkingSkills).toEqual(['focus']);
    expect(report.invalidTasks).toBe(0);
  });

  it('skips invalid rows but keeps counting them', () => {
    const json = JSON.stringify({
      kind: CURRICULUM_KIND,
      version: 1,
      exportedAt: 'x',
      data: {
        tasks: [task(), null],
        habits: [habit(), 'nope'],
        blocks: [{ id: 'b', name: 42 }],
      },
    });
    const report = parseCurriculum(json);
    expect(report.tasks).toHaveLength(1);
    expect(report.habits).toHaveLength(1);
    expect(report.blocks).toHaveLength(0);
    expect(report.invalidTasks).toBe(1);
    expect(report.invalidHabits).toBe(1);
    expect(report.invalidBlocks).toBe(1);
  });

  it('upserts imported tasks into the dynamic bank (override by id)', () => {
    const state = emptyAppState();
    state.dynamicTaskBank = [task({ id: 't1', title: 'Old title' })];
    const report = parseCurriculum(serializeCurriculum([task({ id: 't1', title: 'Naya title' })], [], []));
    const { state: next } = applyCurriculum(state, report);
    expect(next.dynamicTaskBank).toHaveLength(1);
    expect(next.dynamicTaskBank[0].title).toBe('Naya title');
  });

  it('upserts imported habits into customHabits (override by id)', () => {
    const state = emptyAppState();
    state.customHabits = [habit({ id: 'h1', name: 'Old' })];
    const report = parseCurriculum(serializeCurriculum([], [habit({ id: 'h1', name: 'Naya' })], []));
    const { state: next } = applyCurriculum(state, report);
    expect(next.customHabits).toHaveLength(1);
    expect(next.customHabits[0].name).toBe('Naya');
  });

  it('appends new blocks, skips duplicate ids and recomputes extensionDays', () => {
    const state = emptyAppState();
    state.postJourney.customPhases = [
      { id: 'b1', name: 'Old Block', description: '', dayStart: 91, dayEnd: 100, goals: [], habits: [], difficulty: 'medium', createdBy: 'user', createdAt: 'x' },
    ];
    state.postJourney.extensionDays = 10;
    const imported: CustomPhase[] = [
      { id: 'b1', name: 'Old Block (dupe)', description: '', dayStart: 200, dayEnd: 210, goals: [], habits: [], difficulty: 'easy', createdBy: 'user', createdAt: 'x' },
      { id: 'b2', name: 'New Block', description: '', dayStart: 101, dayEnd: 130, goals: [], habits: [], difficulty: 'hard', createdBy: 'user', createdAt: 'x' },
    ];
    const report = parseCurriculum(serializeCurriculum([], [], imported));
    const { state: next, summary } = applyCurriculum(state, report);
    expect(next.postJourney.customPhases.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(next.postJourney.extensionDays).toBe(40); // max(dayEnd - 90) = max(10, 40)
    expect(summary).toContain('1 blocks');
  });

  it('keeps untouched state identical apart from merged sections', () => {
    const state: AppState = emptyAppState();
    state.startDateISO = '2026-08-01';
    state.clearedLevels = [1, 2];
    const before = JSON.stringify(state);
    const report = parseCurriculum(serializeCurriculum([], [], []));
    const { state: next } = applyCurriculum(state, report);
    expect(JSON.stringify(next)).toBe(before);
  });

  it('reports an empty import when nothing valid was provided', () => {
    const state = emptyAppState();
    const { summary } = applyCurriculum(state, { tasks: [], habits: [], blocks: [], invalidTasks: 2, invalidHabits: 0, invalidBlocks: 0 });
    expect(summary).toContain('naya data');
    expect(summary).toContain('skip kiye');
  });
});
