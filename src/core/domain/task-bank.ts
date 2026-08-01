// Task Bank domain model.
// The Task Bank is the single source of truth for tasks. Business logic never
// embeds task lists; it queries this bank through a repository.

export type Slot = 'morning' | 'blocks' | 'night' | 'weekly' | 'monthly';
export type PhaseId = 'jee-core' | 'l-mindset' | 'light-execution' | 'peak-performance';

export type TaskType =
  | 'Beginner'
  | 'Intermediate'
  | 'Advanced'
  | 'Review'
  | 'Recovery'
  | 'Reflection'
  | 'Challenge';

export type EnergyLevel = 'low' | 'medium' | 'high';

/** 1 = trivial, 5 = very demanding. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export type ThinkingSkill =
  | 'planning'
  | 'focus'
  | 'discipline'
  | 'recall'
  | 'analysis'
  | 'reasoning'
  | 'verification'
  | 'reflection'
  | 'systems'
  | 'creativity';

export type UnlockCondition =
  | { type: 'day'; fromDay: number }
  | { type: 'day-exact'; day: number }
  | { type: 'not-day'; day: number }
  | { type: 'phase'; phase: PhaseId }
  | { type: 'habit'; habitId: string }
  | { type: 'exam-window'; daysBeforeExam: number }
  | { type: 'mock-sunday' }
  | { type: 'weekday'; days: number[] }
  | { type: 'day-in'; days: number[] }
  | { type: 'recovery' }
  | { type: 'backlog'; thresholdDays: number }
  | { type: 'revision'; dueAfterDays: number };

export interface JeeRelevance {
  /** Main subject association when applicable. */
  subject?: string;
  /** True when the task is especially valuable in the final exam month. */
  examWindow?: boolean;
  /** 0..1 relevance to JEE performance. */
  score: number;
}

/** Stable, immutable definition of a task inside the Task Bank. */
export interface TaskBankEntry {
  id: string;
  habitId: string;
  title: string;
  description: string;
  phase: PhaseId;
  difficulty: Difficulty;
  estimatedDurationMin: number;
  energyLevel: EnergyLevel;
  tags: string[];
  prerequisites: string[];
  taskType: TaskType;
  /** 0..1 — how well suited to spaced revision. */
  revisionSuitability: number;
  /** 0..1 — how well suited to clearing backlog. */
  backlogSuitability: number;
  thinkingSkills: ThinkingSkill[];
  jeeRelevance: JeeRelevance;
  unlockConditions: UnlockCondition[];
  /** True when the entry is eligible for selection. */
  active: boolean;
  /**
   * Backward-compatibility marker for tasks that used to live inside level
   * definitions. Preserves the exact cadence (unlock day, slot, level order).
   */
  legacy?: {
    levelId: number;
    slot: Slot;
    order: number;
  };
}

export const SLOT_ORDER: readonly Slot[] = ['morning', 'blocks', 'night', 'weekly', 'monthly'];

export const TASK_TYPES: readonly TaskType[] = [
  'Beginner',
  'Intermediate',
  'Advanced',
  'Review',
  'Recovery',
  'Reflection',
  'Challenge',
];

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

export function isSlot(value: unknown): value is Slot {
  return typeof value === 'string' && (SLOT_ORDER as readonly string[]).includes(value);
}

export function isPhaseId(value: unknown): value is PhaseId {
  return (
    typeof value === 'string' &&
    (['jee-core', 'l-mindset', 'light-execution', 'peak-performance'] as string[]).includes(value)
  );
}
