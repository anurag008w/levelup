import { z } from 'zod';
import { cleanImportText } from '../../core/domain/import-utils';
import type { AppState, CustomPhase } from '../../core/domain/state';
import type { Habit } from '../../core/domain/habit';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import { TOTAL_DAYS } from '../../data/curriculum';
import { parseTaskBankEntry, parseHabitEntry } from '../task-bank/validation';

// Curriculum import/export: tasks + habits + custom blocks as one JSON file.
// The user can edit this file (or share it) and re-import — the same workflow
// as the seed files (tasks.json / habits.json) but from inside the app.

export const CURRICULUM_KIND = 'levelup-curriculum';
export const CURRICULUM_VERSION = 1;

const difficultyEnum = z.enum(['easy', 'medium', 'hard', 'extreme']);
const createdByEnum = z.enum(['ai', 'user']);

export const customLevelSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  dayStart: z.number().int().min(1),
  dayEnd: z.number().int().min(1),
  goals: z.array(z.string()).default([]),
  habits: z.array(z.string()).default([]),
});

export const customPhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  dayStart: z.number().int().min(1),
  dayEnd: z.number().int().min(1),
  goals: z.array(z.string()),
  habits: z.array(z.string()),
  difficulty: difficultyEnum,
  createdBy: createdByEnum,
  createdAt: z.string(),
  levels: z.array(customLevelSchema).optional(),
});

export interface CurriculumPayload {
  kind: string;
  version: number;
  exportedAt: string;
  data: {
    tasks: TaskBankEntry[];
    habits: Habit[];
    blocks: CustomPhase[];
  };
}

export interface CurriculumParseReport {
  tasks: TaskBankEntry[];
  habits: Habit[];
  blocks: CustomPhase[];
  invalidTasks: number;
  invalidHabits: number;
  invalidBlocks: number;
}

export interface CurriculumApplyResult {
  state: AppState;
  summary: string;
}

/** Serializes the CURRENT curriculum (merged bank + custom blocks) for download. */
export function serializeCurriculum(tasks: TaskBankEntry[], habits: Habit[], blocks: CustomPhase[]): string {
  const payload: CurriculumPayload = {
    kind: CURRICULUM_KIND,
    version: CURRICULUM_VERSION,
    exportedAt: new Date().toISOString(),
    data: { tasks, habits, blocks },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parses + validates a curriculum JSON file. Invalid rows are skipped, never
 * fatal — the report carries per-section invalid counts for the UI.
 */
export function parseCurriculum(json: string): CurriculumParseReport {
  let raw: unknown;
  try {
    raw = JSON.parse(cleanImportText(json));
  } catch {
    throw new Error('File valid JSON nahi hai. Sahi curriculum file select karo.');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Ye file curriculum format nahi lagti (data section missing).');
  }
  const r = raw as Record<string, unknown>;
  const data = (typeof r.data === 'object' && r.data !== null ? r.data : {}) as Record<string, unknown>;

  const tasks: TaskBankEntry[] = [];
  const habits: Habit[] = [];
  const blocks: CustomPhase[] = [];
  let invalidTasks = 0;
  let invalidHabits = 0;
  let invalidBlocks = 0;

  for (const item of Array.isArray(data.tasks) ? (data.tasks as unknown[]) : []) {
    try {
      tasks.push(parseTaskBankEntry(item));
    } catch {
      invalidTasks++;
    }
  }
  for (const item of Array.isArray(data.habits) ? (data.habits as unknown[]) : []) {
    try {
      habits.push(parseHabitEntry(item));
    } catch {
      invalidHabits++;
    }
  }
  for (const item of Array.isArray(data.blocks) ? (data.blocks as unknown[]) : []) {
    const result = customPhaseSchema.safeParse(item);
    if (result.success) {
      blocks.push(result.data as CustomPhase);
    } else {
      invalidBlocks++;
    }
  }
  return { tasks, habits, blocks, invalidTasks, invalidHabits, invalidBlocks };
}

/**
 * Merges imported curriculum into the current state:
 * - tasks   → upsert into dynamicTaskBank (overrides seed by id; inactive stays hidden).
 * - habits  → upsert into customHabits (overrides seed by id).
 * - blocks  → appended when the id is new, sorted by day; extensionDays recomputed.
 */
export function applyCurriculum(state: AppState, report: CurriculumParseReport): CurriculumApplyResult {
  const taskById = new Map(state.dynamicTaskBank.map((t) => [t.id, t]));
  for (const task of report.tasks) taskById.set(task.id, task);
  const dynamicTaskBank = [...taskById.values()];

  const habitById = new Map(state.customHabits.map((h) => [h.id, h]));
  for (const habit of report.habits) habitById.set(habit.id, habit);
  const customHabits = [...habitById.values()];

  const existingBlockIds = new Set(state.postJourney.customPhases.map((b) => b.id));
  const customPhases = [...state.postJourney.customPhases];
  let appendedBlocks = 0;
  let skippedBlocks = 0;
  for (const block of report.blocks) {
    if (!existingBlockIds.has(block.id)) {
      existingBlockIds.add(block.id);
      customPhases.push(block);
      appendedBlocks++;
    } else {
      skippedBlocks++;
    }
  }
  customPhases.sort((a, b) => a.dayStart - b.dayStart || a.dayEnd - b.dayEnd || a.name.localeCompare(b.name));

  const next: AppState = {
    ...state,
    dynamicTaskBank,
    customHabits,
    postJourney: {
      ...state.postJourney,
      customPhases,
      extensionDays: Math.max(0, ...customPhases.map((b) => b.dayEnd - TOTAL_DAYS)),
    },
  };

  const bits: string[] = [];
  if (report.tasks.length > 0) bits.push(`${report.tasks.length} tasks`);
  if (report.habits.length > 0) bits.push(`${report.habits.length} habits`);
  if (appendedBlocks > 0) bits.push(`${appendedBlocks} blocks`);
  const skipped = report.invalidTasks + report.invalidHabits + report.invalidBlocks + skippedBlocks;
  const suffix = skipped > 0 ? ` · ${skipped} skip kiye (duplicate/invalid)` : '';
  return { state: next, summary: bits.length > 0 ? `Curriculum import: ${bits.join(', ')}${suffix}.` : `Curriculum file mein kuch naya data nahi mila${suffix}.` };
}
