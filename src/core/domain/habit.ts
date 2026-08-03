import type { PhaseId, ThinkingSkill } from './task-bank';

// Habits and the level/phase curriculum structure.

export interface Habit {
  id: string;
  name: string;
  description: string;
  timeRequired: string;
  /** Completion criteria for the habit. */
  criteria: string;
  phase: PhaseId;
  /** Level that introduces the habit (1-30). */
  levelId: number;
  /** First day the habit becomes active (level.dayStart). */
  dayStart: number;
  /** Habit ids that should exist before this habit is meaningful. */
  prerequisites: string[];
  /** True for the core execution habits of the 90-day journey. */
  isCore: boolean;
  /** Thinking skills this habit trains. */
  thinkingSkills: ThinkingSkill[];
  /** False hides the habit (user deleted a seed habit). Absent = active. */
  active?: boolean;
}

export type PhaseColor = 'l' | 'light' | 'core' | 'peak';

export interface Phase {
  id: PhaseId;
  title: string;
  subtitle: string;
  color: PhaseColor;
  levelRange: [number, number];
}

export interface Level {
  id: number; // 1-30
  dayStart: number;
  dayEnd: number;
  phase: PhaseId;
  title: string;
  /** Habits introduced by this level, as task-bank habit ids. */
  newHabitIds: string[];
  passCriteria: string;
  unlockCondition: string;
  commonMistakes: string[];
  jeeBenefit: string;
  /** False = placeholder, content coming in a future update. */
  authored: boolean;
}
