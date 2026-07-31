import { z } from 'zod';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { Habit as HabitEntity } from '../../core/domain/habit';
import { TASK_TYPES, SLOT_ORDER } from '../../core/domain/task-bank';
import { TaskBankValidationError } from '../../core/domain/errors';

const phaseEnum = z.enum(['jee-core', 'l-mindset', 'light-execution', 'peak-performance']);
const slotEnum = z.enum(SLOT_ORDER as [string, ...string[]]);
const taskTypeEnum = z.enum(TASK_TYPES as [string, ...string[]]);
const energyEnum = z.enum(['low', 'medium', 'high']);
const thinkingEnum = z.enum([
  'planning',
  'focus',
  'discipline',
  'recall',
  'analysis',
  'reasoning',
  'verification',
  'reflection',
  'systems',
  'creativity',
]);
const difficultyEnum = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const unlockConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('day'), fromDay: z.number().int().min(1) }),
  z.object({ type: z.literal('phase'), phase: phaseEnum }),
  z.object({ type: z.literal('habit'), habitId: z.string().min(1) }),
  z.object({ type: z.literal('exam-window'), daysBeforeExam: z.number().int().min(0) }),
  z.object({ type: z.literal('mock-sunday') }),
  z.object({ type: z.literal('recovery') }),
  z.object({ type: z.literal('backlog'), thresholdDays: z.number().int().min(1) }),
  z.object({ type: z.literal('revision'), dueAfterDays: z.number().int().min(1) }),
]);

export const taskBankEntrySchema = z.object({
  id: z.string().min(1),
  habitId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  phase: phaseEnum,
  difficulty: difficultyEnum,
  estimatedDurationMin: z.number().int().min(1).max(600),
  energyLevel: energyEnum,
  tags: z.array(z.string()),
  prerequisites: z.array(z.string()),
  taskType: taskTypeEnum,
  revisionSuitability: z.number().min(0).max(1),
  backlogSuitability: z.number().min(0).max(1),
  thinkingSkills: z.array(thinkingEnum),
  jeeRelevance: z.object({
    subject: z.string().optional(),
    examWindow: z.boolean().optional(),
    score: z.number().min(0).max(1),
  }),
  unlockConditions: z.array(unlockConditionSchema).min(1),
  active: z.boolean(),
  legacy: z
    .object({
      levelId: z.number().int(),
      slot: slotEnum,
      order: z.number().int().min(0),
    })
    .optional(),
});

export const habitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  timeRequired: z.string().default(''),
  criteria: z.string().min(1),
  phase: phaseEnum,
  levelId: z.number().int().min(1).max(30),
  dayStart: z.number().int().min(1),
  prerequisites: z.array(z.string()),
  isCore: z.boolean().default(true),
  thinkingSkills: z.array(thinkingEnum),
});

function parseEntry(raw: unknown): TaskBankEntry {
  const result = taskBankEntrySchema.safeParse(raw);
  if (!result.success) {
    throw new TaskBankValidationError(
      `Invalid task bank entry: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data as TaskBankEntry;
}

function parseHabit(raw: unknown): HabitEntity {
  const result = habitSchema.safeParse(raw);
  if (!result.success) {
    throw new TaskBankValidationError(
      `Invalid habit: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data as HabitEntity;
}

export interface ValidationReport {
  validTasks: TaskBankEntry[];
  invalidTasks: unknown[];
  validHabits: HabitEntity[];
  invalidHabits: unknown[];
}

/**
 * Validates a whole seed payload, skipping (never crashing on) invalid rows.
 * This keeps the bank safe to extend: a bad row is reported, not fatal.
 */
export function validateSeed(rawTasks: unknown[], rawHabits: unknown[]): ValidationReport {
  const validTasks: TaskBankEntry[] = [];
  const invalidTasks: unknown[] = [];
  for (const raw of rawTasks) {
    try {
      validTasks.push(parseEntry(raw));
    } catch {
      invalidTasks.push(raw);
    }
  }
  const validHabits: HabitEntity[] = [];
  const invalidHabits: unknown[] = [];
  for (const raw of rawHabits) {
    try {
      validHabits.push(parseHabit(raw));
    } catch {
      invalidHabits.push(raw);
    }
  }
  return { validTasks, invalidTasks, validHabits, invalidHabits };
}

export function parseTaskBankEntry(raw: unknown): TaskBankEntry {
  return parseEntry(raw);
}

export function parseHabitEntry(raw: unknown): HabitEntity {
  return parseHabit(raw);
}
