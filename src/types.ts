// ---- Curriculum content types ----

export type Slot = 'morning' | 'blocks' | 'night' | 'weekly' | 'monthly';

export interface Habit {
  id: string;
  name: string;
  timeRequired: string;
  criteria: string; // ✅ completion criteria
}

export interface DailyTask {
  id: string;
  slot: Slot;
  text: string;
  habitId: string; // links back to a Habit introduced in this or an earlier level
}

export type PhaseId = 'jee-core' | 'l-mindset' | 'light-execution' | 'peak-performance';

export interface Phase {
  id: PhaseId;
  title: string;
  subtitle: string;
  color: 'l' | 'light' | 'core' | 'peak';
  levelRange: [number, number];
}

export interface Level {
  id: number; // 1-30
  dayStart: number;
  dayEnd: number;
  phase: PhaseId;
  title: string;
  newHabits: Habit[];
  dailyTasks: DailyTask[]; // only NEW tasks introduced in this level
  passCriteria: string;
  unlockCondition: string;
  commonMistakes: string[];
  jeeBenefit: string;
  authored: boolean; // false = placeholder, content coming in a future update
}

// ---- Progress / storage types ----

export interface DayLog {
  // taskId -> done
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

export interface AppState {
  startDateISO: string | null; // Day 1 date, set on first launch
  bonusDaysUsed: number; // backlog recovery offset
  taskLogs: Record<string, DayLog>; // dateISO -> tasks done that date
  weeklyReviews: WeeklyReviewEntry[];
  monthlyAssessments: MonthlyAssessmentEntry[];
  failureLog: FailureLogEntry[];
  examDateISO: string | null; // JEE Main attempt date, for Exam Month Protocol
  clearedLevels: number[];
}
