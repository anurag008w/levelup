import { z } from 'zod';
import { cleanImportText } from '../../core/domain/import-utils';
import type { AppState, CustomPhase } from '../../core/domain/state';
import type { Habit } from '../../core/domain/habit';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import { TASK_TYPES } from '../../core/domain/task-bank';
import { TOTAL_DAYS } from '../../data/curriculum';
import { parseTaskBankEntry, parseHabitEntry, THINKING_SKILLS, PHASES, ENERGY_LEVELS, unlockConditionSchema } from '../task-bank/validation';

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
 *
 * Every row gets a strict-parse attempt first; if that fails (older app
 * version, hand-edited file, an unrecognized enum value, etc.) we try again
 * with `coerceImportedTask`/`coerceImportedHabit`, which repairs the row
 * instead of throwing it away. A row only ends up in the invalid count if
 * it isn't even a usable object — a single stray field should never cost
 * the user the whole task/habit on re-import.
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
    if (typeof item !== 'object' || item === null) {
      invalidTasks++;
      continue;
    }
    try {
      tasks.push(parseTaskBankEntry(item));
      continue;
    } catch {
      // fall through to repair attempt
    }
    try {
      tasks.push(parseTaskBankEntry(coerceImportedTask(item as Record<string, unknown>)));
    } catch {
      invalidTasks++;
    }
  }
  for (const item of Array.isArray(data.habits) ? (data.habits as unknown[]) : []) {
    if (typeof item !== 'object' || item === null) {
      invalidHabits++;
      continue;
    }
    try {
      habits.push(parseHabitEntry(item));
      continue;
    } catch {
      // fall through to repair attempt
    }
    try {
      habits.push(parseHabitEntry(coerceImportedHabit(item as Record<string, unknown>)));
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

const THINKING_SKILL_SET = new Set<string>(THINKING_SKILLS);
const PHASE_SET = new Set<string>(PHASES);
const ENERGY_SET = new Set<string>(ENERGY_LEVELS);
const TASK_TYPE_SET = new Set<string>(TASK_TYPES);

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01(v: unknown): number {
  const n = toNumber(v);
  return n === null ? 0.5 : Math.min(1, Math.max(0, n));
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Best-effort repair for an imported task row that failed strict schema
 * validation. Unrecognized enum values are dropped/defaulted and malformed
 * unlockConditions are filtered (instead of rejecting the whole row) so a
 * single bad field doesn't cost the user the entire task.
 */
function coerceImportedTask(raw: Record<string, unknown>): Record<string, unknown> {
  const jeeRel = (typeof raw.jeeRelevance === 'object' && raw.jeeRelevance !== null ? raw.jeeRelevance : {}) as Record<string, unknown>;
  const rawUnlocks = Array.isArray(raw.unlockConditions) ? raw.unlockConditions : [];
  const validUnlocks = rawUnlocks.filter((u) => unlockConditionSchema.safeParse(u).success);
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomId('imported-task'),
    habitId: typeof raw.habitId === 'string' && raw.habitId.length > 0 ? raw.habitId : 'h1',
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : 'Imported task',
    description: typeof raw.description === 'string' ? raw.description : '',
    phase: typeof raw.phase === 'string' && PHASE_SET.has(raw.phase) ? raw.phase : 'jee-core',
    difficulty: Math.round(Math.min(5, Math.max(1, toNumber(raw.difficulty) ?? 3))),
    estimatedDurationMin: Math.round(Math.min(600, Math.max(1, toNumber(raw.estimatedDurationMin) ?? 30))),
    energyLevel: typeof raw.energyLevel === 'string' && ENERGY_SET.has(raw.energyLevel) ? raw.energyLevel : 'medium',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.filter((p) => typeof p === 'string') : [],
    taskType: typeof raw.taskType === 'string' && TASK_TYPE_SET.has(raw.taskType) ? raw.taskType : 'Beginner',
    revisionSuitability: clamp01(raw.revisionSuitability),
    backlogSuitability: clamp01(raw.backlogSuitability),
    thinkingSkills: Array.isArray(raw.thinkingSkills)
      ? [...new Set(raw.thinkingSkills.filter((s) => typeof s === 'string' && THINKING_SKILL_SET.has(s)))]
      : [],
    jeeRelevance: {
      subject: typeof jeeRel.subject === 'string' ? jeeRel.subject : undefined,
      examWindow: typeof jeeRel.examWindow === 'boolean' ? jeeRel.examWindow : undefined,
      score: clamp01(jeeRel.score),
    },
    unlockConditions: validUnlocks.length > 0 ? validUnlocks : [{ type: 'day', fromDay: 1 }],
    active: typeof raw.active === 'boolean' ? raw.active : true,
  };
}

/** Same idea as `coerceImportedTask`, for habit rows. */
function coerceImportedHabit(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomId('imported-habit'),
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : 'Imported habit',
    description: typeof raw.description === 'string' ? raw.description : '',
    timeRequired: typeof raw.timeRequired === 'string' ? raw.timeRequired : '',
    criteria: typeof raw.criteria === 'string' && raw.criteria.length > 0 ? raw.criteria : 'Complete kiya',
    phase: typeof raw.phase === 'string' && PHASE_SET.has(raw.phase) ? raw.phase : 'jee-core',
    levelId: Math.round(Math.min(30, Math.max(1, toNumber(raw.levelId) ?? 1))),
    dayStart: Math.round(Math.max(1, toNumber(raw.dayStart) ?? 1)),
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.filter((p) => typeof p === 'string') : [],
    isCore: typeof raw.isCore === 'boolean' ? raw.isCore : true,
    thinkingSkills: Array.isArray(raw.thinkingSkills)
      ? [...new Set(raw.thinkingSkills.filter((s) => typeof s === 'string' && THINKING_SKILL_SET.has(s)))]
      : [],
    active: typeof raw.active === 'boolean' ? raw.active : true,
  };
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
