import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { AppState } from '../../../core/domain/state';
import type { DailyPlan, PlannedTask, TaskGroup } from '../../../core/domain/progress';
import type { TaskBankEntry } from '../../../core/domain/task-bank';
import { formatDayLabel, formatPlanProgress, formatScheduledTasks } from '../plan-format';

function entry(id: string, overrides: Partial<TaskBankEntry> = {}): TaskBankEntry {
  return {
    id,
    habitId: 'daily_planning',
    title: `Task ${id}`,
    description: '',
    phase: 'jee-core',
    difficulty: 2,
    estimatedDurationMin: 30,
    energyLevel: 'medium',
    tags: [],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.5,
    backlogSuitability: 0.5,
    thinkingSkills: ['planning'],
    jeeRelevance: { score: 0.6 },
    unlockConditions: [{ type: 'day', fromDay: 1 }],
    active: true,
    ...overrides,
  };
}

function planned(task: TaskBankEntry, group: TaskGroup, required = true): PlannedTask {
  return {
    entry: task,
    source: 'bank',
    reason: 'test',
    slot: group === 'night' ? 'night' : group === 'weekly' ? 'weekly' : 'morning',
    group,
    required,
    score: 1,
    logKey: '2026-01-01',
  };
}

function plan(tasks: PlannedTask[]): DailyPlan {
  return {
    dateISO: '2026-01-01',
    dayNumber: 1,
    tasks,
    generatedAt: '2026-01-01T00:00:00Z',
    generationStrategy: 'bank',
    contextSummary: '',
  };
}

describe('plan-format', () => {
  it('formatDayLabel renders a readable UTC label', () => {
    expect(formatDayLabel('2026-01-01')).toContain('Jan');
    expect(formatDayLabel('2026-01-01')).toContain('2026');
    expect(formatDayLabel('2026-03-31')).toContain('Mar');
  });

  it('formatPlanProgress counts done tasks against the plan', () => {
    const p = plan([
      planned(entry('a'), 'morning'),
      planned(entry('b'), 'blocks'),
      planned(entry('c'), 'night'),
    ]);
    const state: AppState = { ...emptyAppState(), taskLogs: { '2026-01-01': { a: true, c: true } } };
    expect(formatPlanProgress(p, state)).toBe('2/3 done (67%)');
    expect(formatPlanProgress(plan([]), state)).toBe('0/0 done (0%)');
  });

  it('formatScheduledTasks lists tasks with computed time windows', () => {
    const p = plan([
      planned(entry('a', { estimatedDurationMin: 30 }), 'morning'),
      planned(entry('b', { estimatedDurationMin: 45 }), 'blocks'),
    ]);
    const lines = formatScheduledTasks(p, emptyAppState());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('06:00-06:30');
    expect(lines[0]).toContain('[todo]');
    expect(lines[0]).toContain('[required]');
    expect(lines[1]).toContain('16:00-16:45'); // same group; buffer only shifts the NEXT task
  });

  it('formatScheduledTasks honours the limit argument', () => {
    const p = plan([
      planned(entry('a'), 'morning'),
      planned(entry('b'), 'morning'),
      planned(entry('c'), 'morning'),
    ]);
    expect(formatScheduledTasks(p, emptyAppState(), 2)).toHaveLength(2);
  });

  it('formatScheduledTasks marks done tasks and optional groups', () => {
    const p = plan([
      planned(entry('a'), 'morning'),
      planned(entry('b'), 'bonus', false),
    ]);
    const state: AppState = { ...emptyAppState(), taskLogs: { '2026-01-01': { a: true } } };
    const lines = formatScheduledTasks(p, state);
    expect(lines[0]).toContain('[done]');
    expect(lines[1]).toContain('[optional]');
    expect(lines[1]).toContain('bonus');
  });

  it('formatScheduledTasks wraps past-midnight windows back to 24h', () => {
    const p = plan([
      planned(entry('a', { estimatedDurationMin: 50 }), 'night'), // first: 21:00-21:50
      planned(entry('b', { estimatedDurationMin: 200 }), 'night'), // 21:50 + 10 buffer = 22:00-25:40 → wraps
    ]);
    const lines = formatScheduledTasks(p, emptyAppState());
    expect(lines[0]).toContain('21:00-21:50');
    expect(lines[1]).toContain('22:00-01:20'); // 22:00 + 200min = 25:20 → 01:20
  });

  it('formatScheduledTasks embeds metadata for AI visibility', () => {
    const task = entry('m1', {
      jeeRelevance: { score: 0.8, subject: 'physics' },
      tags: ['formula'],
      thinkingSkills: ['analysis'],
      description: 'derivation practice',
      difficulty: 3,
      revisionSuitability: 0.9,
      backlogSuitability: 0.2,
      energyLevel: 'high',
    });
    const line = formatScheduledTasks(plan([planned(task, 'morning')]), emptyAppState())[0];
    expect(line).toContain('id:m1');
    expect(line).toContain('subject:physics');
    expect(line).toContain('tags:formula');
    expect(line).toContain('thinking:analysis');
    expect(line).toContain('desc:derivation practice');
    expect(line).toContain('difficulty:3/5');
  });
});
