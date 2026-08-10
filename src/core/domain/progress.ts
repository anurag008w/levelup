import type { Slot, TaskBankEntry, PhaseId } from './task-bank';
import type { DailySummary } from './summary';

// Progress state and the daily plan produced by the Habit Progression Engine.

export interface DayLog {
  [taskId: string]: boolean;
}

export interface WeeklyReviewEntry {
  weekNumber: number;
  dateISO: string;
  strongest: string;
  weakest: string;
  planForNextWeek: string;
}

export interface MonthlyAssessmentEntry {
  monthNumber: number;
  dateISO: string;
  reflection: string;
}

export interface FailureLogEntry {
  dateISO: string;
  completionPct: number;
  note: string;
}

export type PlanSource = 'bank' | 'ai';

/** Presentation group used by the Today screen (matches legacy layout). */
export type TaskGroup = 'morning' | 'blocks' | 'night' | 'weekly' | 'monthly' | 'mock' | 'exam' | 'bonus';

export interface PlannedTask {
  /** Source of truth entry. For AI-generated tasks it is persisted in the bank. */
  entry: TaskBankEntry;
  source: PlanSource;
  /** Human-readable reason for selection (observability). */
  reason: string;
  slot: Slot;
  /** Presentation group for the UI. */
  group: TaskGroup;
  /** False in recovery mode for non-core tasks and for AI-recommended extras. */
  required: boolean;
  /** Rank score used during selection. */
  score: number;
  /** Storage key holding this task's completion checkbox. */
  logKey: string;
}

export interface DailyPlan {
  dateISO: string;
  dayNumber: number;
  tasks: PlannedTask[];
  generatedAt: string;
  generationStrategy: PlanSource;
  /** Compact description of the state that produced this plan. */
  contextSummary: string;
}

/**
 * Everything the progression engine knows when planning a day. Built from
 * persisted state + previous summaries; never randomly chosen.
 */
export interface PlanningContext {
  dateISO: string;
  dayNumber: number;
  phase: PhaseId;
  unlockedHabitIds: string[];
  completedTaskIds: Set<string>;
  missedTaskIds: Set<string>;
  streak: number;
  weakHabitIds: string[];
  strongHabitIds: string[];
  /** 0..1 — how heavy JEE workload is right now. */
  jeeWorkload: number;
  /** Number of days with a missed/low-completion backlog. */
  backlogDays: number;
  /** Habit ids whose revision is currently due. */
  revisionDueHabitIds: string[];
  /** Available study time in minutes today. */
  availableMinutes: number;
  recoveryMode: boolean;
  examWindowActive: boolean;
  mockSunday: boolean;
  /** Actual calendar weekday (0=Sunday..6=Saturday) of the planned date. */
  weekday: number;
  /** True when this journey day is marked as a rest/holiday day. */
  restDay: boolean;
  /** ids of tasks that reached mastery (completed bucket) — excluded from the
   *  daily plan unless scheduled for today. */
  masteredTaskIds: Set<string>;
  /** ids of mastered tasks manually scheduled for THIS content day. */
  scheduledTaskIds: Set<string>;
  /** entries of mastered tasks manually scheduled for THIS content day
   *  (re-injected into the plan by the planner). */
  scheduledMasteredEntries: TaskBankEntry[];
  /** Days since last fully-completed day (gap detection). */
  gapDays: number;
  recentSummaries: DailySummary[];
  /** Custom/AI tasks persisted in the dynamic bank (always eligible for the plan). */
  dynamicEntries: TaskBankEntry[];
}

export interface ProgressionConfig {
  availableMinutes: number;
  /** Completion % under which a day counts as missed. */
  missedThresholdPct: number;
  /** Completion % under which recovery mode activates. */
  recoveryThresholdPct: number;
  /** Minimum backlog days before backlog tasks are injected. */
  backlogThresholdDays: number;
  /** Max AI-injected tasks beyond the base plan. */
  maxInjectedTasks: number;
  /** Whether the AI layer is allowed at all. */
  aiEnabled: boolean;
}

export const DEFAULT_PROGRESSION_CONFIG: ProgressionConfig = {
  availableMinutes: 360,
  missedThresholdPct: 30,
  recoveryThresholdPct: 30,
  backlogThresholdDays: 3,
  maxInjectedTasks: 3,
  aiEnabled: true,
};
