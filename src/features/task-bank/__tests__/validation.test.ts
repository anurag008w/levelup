/**
 * Comprehensive tests for Task Bank Validation
 * Tests parsing, schema validation, error handling, and edge cases
 */
import { describe, it, expect } from 'vitest';
import { taskBankEntrySchema, habitSchema, validateSeed, parseTaskBankEntry, parseHabitEntry } from '../validation';
import type { TaskBankEntry } from '../../../core/domain/task-bank';
import type { Habit as HabitEntity } from '../../../core/domain/habit';

// Helper to create valid task entry
function validTaskEntry(overrides = {}): TaskBankEntry {
  return {
    id: 'test_task_1',
    habitId: 'active_recall',
    title: 'Daily Active Recall',
    description: 'Practice active recall technique',
    phase: 'jee-core',
    difficulty: 2,
    estimatedDurationMin: 30,
    energyLevel: 'medium',
    tags: ['memory', 'review'],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.8,
    backlogSuitability: 0.3,
    thinkingSkills: ['recall', 'focus'],
    jeeRelevance: { score: 0.7 },
    unlockConditions: [{ type: 'day', fromDay: 1 }],
    active: true,
    ...overrides,
  };
}

// Helper to create valid habit
function validHabit(overrides = {}): HabitEntity {
  return {
    id: 'active_recall',
    name: 'Active Recall',
    description: 'Practice active recall technique',
    timeRequired: '15-30 min',
    criteria: 'Complete 3 recall sessions',
    phase: 'jee-core',
    levelId: 1,
    dayStart: 1,
    prerequisites: [],
    isCore: true,
    thinkingSkills: ['recall'],
    ...overrides,
  };
}

describe('Task Bank Entry Schema Validation', () => {
  describe('Valid Entries', () => {
    it('validates a complete task entry', () => {
      const entry = validTaskEntry();
      const result = taskBankEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('validates entry with legacy field', () => {
      const entry = validTaskEntry({
        legacy: { levelId: 1, slot: 'morning', order: 0 },
      });
      const result = taskBankEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('validates entry with subject in jeeRelevance', () => {
      const entry = validTaskEntry({
        jeeRelevance: { subject: 'physics', score: 0.9 },
      });
      const result = taskBankEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('validates entry with all thinking skills', () => {
      const entry = validTaskEntry({
        thinkingSkills: ['planning', 'focus', 'discipline', 'recall', 'analysis', 'reasoning', 'verification', 'reflection', 'systems', 'creativity'],
      });
      const result = taskBankEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('validates entry with all task types', () => {
      const taskTypes = ['Beginner', 'Intermediate', 'Advanced', 'Review', 'Recovery', 'Reflection', 'Challenge'];
      for (const taskType of taskTypes) {
        const entry = validTaskEntry({ taskType: taskType as TaskBankEntry['taskType'] });
        const result = taskBankEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });

    it('validates entry with all energy levels', () => {
      for (const level of ['low', 'medium', 'high'] as const) {
        const entry = validTaskEntry({ energyLevel: level });
        const result = taskBankEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });

    it('validates entry with all difficulty levels', () => {
      for (const difficulty of [1, 2, 3, 4, 5] as const) {
        const entry = validTaskEntry({ difficulty });
        const result = taskBankEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('Unlock Conditions', () => {
    it('validates day-based unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'day', fromDay: 5 }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates day-exact unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'day-exact', day: 15 }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates not-day unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'not-day', day: 10 }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates phase-based unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'phase', phase: 'jee-core' }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates habit-based unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'habit', habitId: 'active_recall' }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates exam-window unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'exam-window', daysBeforeExam: 30 }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates mock-sunday unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'mock-sunday' }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates weekday unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'weekday', days: [0, 6] }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates day-in unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'day-in', days: [1, 15, 30] }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates recovery unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'recovery' }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates backlog unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'backlog', thresholdDays: 3 }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates revision unlock', () => {
      const entry = validTaskEntry({
        unlockConditions: [{ type: 'revision', dueAfterDays: 7 }],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });

    it('validates multiple unlock conditions', () => {
      const entry = validTaskEntry({
        unlockConditions: [
          { type: 'day', fromDay: 5 },
          { type: 'habit', habitId: 'active_recall' },
        ],
      });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(true);
    });
  });

  describe('Invalid Entries', () => {
    it('rejects missing id', () => {
      const entry = { ...validTaskEntry(), id: undefined };
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects empty id', () => {
      const entry = validTaskEntry({ id: '' });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects missing habitId', () => {
      const entry = { ...validTaskEntry(), habitId: undefined };
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects empty habitId', () => {
      const entry = validTaskEntry({ habitId: '' });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects missing title', () => {
      const entry = { ...validTaskEntry(), title: undefined };
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects empty title', () => {
      const entry = validTaskEntry({ title: '' });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects invalid phase', () => {
      const entry = validTaskEntry({ phase: 'invalid-phase' });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects invalid task type', () => {
      const entry = validTaskEntry({ taskType: 'InvalidType' });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects invalid energy level', () => {
      const entry = validTaskEntry({ energyLevel: 'extreme' });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects difficulty less than 1', () => {
      const entry = validTaskEntry({ difficulty: 0 });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects difficulty greater than 5', () => {
      const entry = validTaskEntry({ difficulty: 6 });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects duration less than 1', () => {
      const entry = validTaskEntry({ estimatedDurationMin: 0 });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects duration greater than 600', () => {
      const entry = validTaskEntry({ estimatedDurationMin: 601 });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects revision suitability less than 0', () => {
      const entry = validTaskEntry({ revisionSuitability: -0.1 });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects revision suitability greater than 1', () => {
      const entry = validTaskEntry({ revisionSuitability: 1.5 });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects empty unlock conditions', () => {
      const entry = validTaskEntry({ unlockConditions: [] });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects invalid unlock condition type', () => {
      const entry = validTaskEntry({ unlockConditions: [{ type: 'invalid-type' } as any] });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects day-exact with day > 90', () => {
      const entry = validTaskEntry({ unlockConditions: [{ type: 'day-exact', day: 100 }] });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });

    it('rejects invalid thinking skill', () => {
      const entry = validTaskEntry({ thinkingSkills: ['invalid_skill' as any] });
      expect(taskBankEntrySchema.safeParse(entry).success).toBe(false);
    });
  });
});

describe('Habit Schema Validation', () => {
  describe('Valid Habits', () => {
    it('validates a complete habit', () => {
      const habit = validHabit();
      const result = habitSchema.safeParse(habit);
      expect(result.success).toBe(true);
    });

    it('validates habit with all thinking skills', () => {
      const habit = validHabit({
        thinkingSkills: ['planning', 'focus', 'recall', 'analysis'],
      });
      expect(habitSchema.safeParse(habit).success).toBe(true);
    });

    it('validates habit with prerequisites', () => {
      const habit = validHabit({
        prerequisites: ['habit_1', 'habit_2'],
      });
      expect(habitSchema.safeParse(habit).success).toBe(true);
    });
  });

  describe('Invalid Habits', () => {
    it('rejects missing id', () => {
      const habit = { ...validHabit(), id: undefined };
      expect(habitSchema.safeParse(habit).success).toBe(false);
    });

    it('rejects empty id', () => {
      const habit = validHabit({ id: '' });
      expect(habitSchema.safeParse(habit).success).toBe(false);
    });

    it('rejects missing name', () => {
      const habit = { ...validHabit(), name: undefined };
      expect(habitSchema.safeParse(habit).success).toBe(false);
    });

    it('rejects invalid phase', () => {
      const habit = validHabit({ phase: 'invalid' });
      expect(habitSchema.safeParse(habit).success).toBe(false);
    });

    it('rejects levelId less than 1', () => {
      const habit = validHabit({ levelId: 0 });
      expect(habitSchema.safeParse(habit).success).toBe(false);
    });

    it('rejects levelId greater than 30', () => {
      const habit = validHabit({ levelId: 31 });
      expect(habitSchema.safeParse(habit).success).toBe(false);
    });
  });
});

describe('validateSeed', () => {
  it('validates mixed valid and invalid entries', () => {
    const tasks = [
      validTaskEntry({ id: 'task_1' }),
      { invalid: 'task' },
      validTaskEntry({ id: 'task_2' }),
      null,
    ];
    const habits = [
      validHabit({ id: 'habit_1' }),
      { invalid: 'habit' },
    ];

    const report = validateSeed(tasks, habits);

    expect(report.validTasks).toHaveLength(2);
    expect(report.invalidTasks).toHaveLength(2);
    expect(report.validHabits).toHaveLength(1);
    expect(report.invalidHabits).toHaveLength(1);
  });

  it('handles empty arrays', () => {
    const report = validateSeed([], []);

    expect(report.validTasks).toHaveLength(0);
    expect(report.invalidTasks).toHaveLength(0);
    expect(report.validHabits).toHaveLength(0);
    expect(report.invalidHabits).toHaveLength(0);
  });

  it('handles all valid entries', () => {
    const tasks = [validTaskEntry({ id: 't1' }), validTaskEntry({ id: 't2', taskType: 'Review' })];
    const habits = [validHabit({ id: 'h1' })];

    const report = validateSeed(tasks, habits);

    expect(report.validTasks).toHaveLength(2);
    expect(report.invalidTasks).toHaveLength(0);
    expect(report.validHabits).toHaveLength(1);
    expect(report.invalidHabits).toHaveLength(0);
  });
});

describe('parseTaskBankEntry', () => {
  it('parses valid entry', () => {
    const entry = validTaskEntry();
    const result = parseTaskBankEntry(entry);
    expect(result.id).toBe(entry.id);
    expect(result.title).toBe(entry.title);
  });

  it('throws on invalid entry', () => {
    expect(() => parseTaskBankEntry({ invalid: 'entry' })).toThrow();
  });
});

describe('parseHabitEntry', () => {
  it('parses valid habit', () => {
    const habit = validHabit();
    const result = parseHabitEntry(habit);
    expect(result.id).toBe(habit.id);
    expect(result.name).toBe(habit.name);
  });

  it('throws on invalid habit', () => {
    expect(() => parseHabitEntry({ invalid: 'habit' })).toThrow();
  });
});
