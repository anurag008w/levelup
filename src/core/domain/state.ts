import type { MemoryStore } from './memory';
import type { DailySummary } from './summary';
import type { DailyPlan } from './progress';
import type { ProviderConfig, ModelInfo, ThinkingLevel } from './llm';
import type { TaskBankEntry } from './task-bank';
import type { Habit } from './habit';
import type { AiActionHistoryState } from './ai-actions';
import type { SubjectPlanner } from './subject-planner';
import type { StudyResource } from './study-vault';
import type { CustomTodoTask } from './todo-tasks';
import { emptyAiActionHistory } from './ai-actions';
import { INTERNAL_SYSTEM_PROMPT } from './chat';

// Persisted application state (localStorage). Schema v2.

export const STATE_SCHEMA_VERSION = 2;

export interface AiSettings {
  providers: Record<string, ProviderConfig>;
  activeProviderId: string | null;
  /** Locally cached model catalogs per provider: id -> models. */
  modelCache: Record<string, ModelInfo[]>;
  /** Whether the AI layer participates in planning (master switch). */
  aiEnabled: boolean;
  /** Chat-specific settings */
  chat: ChatSettings;
  /** Live web search: which provider/search is used and how it's configured. */
  websearch: WebSearchSettings;
}

/** Search backends available for live web search. */
export type WebSearchProviderId = 'google' | 'smartrotator';

export interface WebSearchSettings {
  /** Master switch — ON = the AI live-searches before answering. */
  enabled: boolean;
  /** Which search backend to use. */
  providerId: WebSearchProviderId | null;
  /** Model used by the chosen search backend (Gemini model for Google). */
  model: string;
  /** User-supplied API key (Google). SmartRotator reuses the login key. */
  apiKey: string;
  /** Optional base URL override (Google). Empty = official endpoint. */
  baseUrl: string;
}

export function defaultWebSearchSettings(): WebSearchSettings {
  return {
    enabled: false,
    providerId: null,
    model: 'gemini-2.5-flash',
    apiKey: '',
    baseUrl: '',
  };
}

/** Global AI chat settings */
export interface ChatSettings {
  /** Response creativity (0-1) */
  temperature: number;
  /** Max response length */
  maxTokens: number;
  /** Hidden system persona / coach instructions */
  systemPrompt: string;
  /** Optional user-side persona / personal custom instructions */
  userPersona: string;
  /** Remember conversation context */
  memoryEnabled: boolean;
  /** Save chats to history */
  autoSaveChats: boolean;
  /** Number of past messages to remember */
  conversationHistoryLength: number;
  /** Include journey context in prompts */
  includeJourneyContext: boolean;
  /** Show thinking process */
  showThinking: boolean;
  /** Reasoning effort / thinking budget for chat replies */
  thinking?: ThinkingLevel;
  /** Thinking budget for tool DECISION hops (undefined = off: fast, cheap,
   *  deterministic JSON). Applying "provider default" here would silently
   *  enable thinking on providers that ship with it — tool picks stay off by
   *  default so multi-hop tool flows stay cheap and reliable. */
  toolThinking?: ThinkingLevel;
  /** Max output tokens for tool decision hops (default 1024 — one compact JSON
   *  batch; raise it for very large batches / multi-tool requests). */
  toolMaxTokens: number;
  /** Max output tokens for background memory summaries (default 8000). */
  memorySummaryMaxTokens: number;
  /** Thinking level for background memory summaries (default medium — the
   *  condensed blocks are worth the extra reasoning tokens). */
  memorySummaryThinking?: ThinkingLevel;
  /** Custom system prompt for background memory summaries (undefined = the
   *  built-in instructions). Advanced users can tailor the block style here. */
  memorySummaryPrompt?: string;
}

export interface UserProfile {
  name: string;
  classLevel: string;
  examTarget: string;
  studyStyle: string;
  notes: string;
}

export function defaultUserProfile(): UserProfile {
  return {
    name: '',
    classLevel: '',
    examTarget: '',
    studyStyle: '',
    notes: '',
  };
}

export function defaultChatSettings(): ChatSettings {
  return {
    temperature: 0.7,
    maxTokens: 8192,
    systemPrompt: INTERNAL_SYSTEM_PROMPT,
    userPersona: '',
    memoryEnabled: true,
    autoSaveChats: true,
    conversationHistoryLength: 10,
    includeJourneyContext: true,
    showThinking: false,
    toolMaxTokens: 1024,
    memorySummaryMaxTokens: 8000,
    memorySummaryThinking: 'medium',
  };
}

// ===== POST-JOURNEY SYSTEM =====

export type MasteryLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface MasteryConfig {
  /** User's overall mastery level */
  level: MasteryLevel;
  /** Topic-wise mastery scores (topicId -> score 0-100) */
  topicScores: Record<string, number>;
  /** Mastery unlocked date */
  unlockedAt: string | null;
}

export interface CustomLevel {
  id: string;
  title: string;
  dayStart: number;
  dayEnd: number;
  goals: string[];
  habits: string[];
}

export interface CustomPhase {
  id: string;
  name: string;
  description: string;
  dayStart: number;
  dayEnd: number;
  goals: string[];
  habits: string[];
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
  createdBy: 'ai' | 'user';
  createdAt: string;
  /**
   * Optional sub-levels inside this block. When present the Levels screen
   * renders the block as a group header followed by its levels (styled like
   * the built-in journey levels). Absent = legacy single-card block.
   */
  levels?: CustomLevel[];
}

export interface PostJourneyState {
  /** Is journey complete (day 90+ reached) */
  journeyComplete: boolean;
  /** Date when journey was completed */
  completedAt: string | null;
  /** Total days in current extension */
  extensionDays: number;
  /** Mastery configuration */
  mastery: MasteryConfig;
  /** Custom phases created by user or AI */
  customPhases: CustomPhase[];
  /** Current active custom phase */
  activeCustomPhaseId: string | null;
  /** AI-generated phase suggestions pending approval */
  pendingAISuggestions: CustomPhase[];
  /** Stats from completed journey */
  finalStats: JourneyFinalStats | null;
}

export interface JourneyFinalStats {
  totalTasksCompleted: number;
  averageAccuracy: number;
  strongestHabit: string;
  weakestHabit: string;
  totalStudyHours: number;
  streakDays: number;
  levelCleared: number;
  phaseReached: string;
}

export function defaultMasteryConfig(): MasteryConfig {
  return {
    level: 'beginner',
    topicScores: {},
    unlockedAt: null,
  };
}

export function defaultPostJourney(): PostJourneyState {
  return {
    journeyComplete: false,
    completedAt: null,
    extensionDays: 0,
    mastery: defaultMasteryConfig(),
    customPhases: [],
    activeCustomPhaseId: null,
    pendingAISuggestions: [],
    finalStats: null,
  };
}

export interface AppState {
  schemaVersion: number;

  // --- legacy v1 fields (kept for backward compatibility) ---
  startDateISO: string | null;
  bonusDaysUsed: number;
  taskLogs: Record<string, import('./progress').DayLog>;
  weeklyReviews: import('./progress').WeeklyReviewEntry[];
  monthlyAssessments: import('./progress').MonthlyAssessmentEntry[];
  failureLog: import('./progress').FailureLogEntry[];
  examDateISO: string | null;
  clearedLevels: number[];

  // --- v2 fields ---
  memory: MemoryStore;
  summaries: DailySummary[];
  aiSettings: AiSettings;
  /** AI-generated / user-created tasks persisted into the dynamic bank. */
  dynamicTaskBank: TaskBankEntry[];
  /** Journey day numbers marked as rest/holiday (no auto-plan; only explicit tasks). */
  restDays: number[];
  /** Journey day numbers marked as TEST days — mock tests appear only on these days. */
  testDays: number[];
  /** Manual mastery placement overrides. `completed` pins a task to the
   *  completed bucket; `scheduled` books a mastered task into a specific
   *  content day's plan (one-shot, falls back to completed afterwards). */
  masteryPlacement: Record<string, { bucket: 'completed' } | { bucket: 'scheduled'; day: number }>;
  /** One generated plan per dateISO. */
  planCache: Record<string, DailyPlan>;
  /** Daily available study time in minutes. */
  studyTimeMinutes: number;
  /** Versioned, undoable audit trail for AI-generated application changes. */
  aiActionHistory: AiActionHistoryState;
  lastSummaryDate: string | null;
  
  // --- v3: Post-Journey System ---
  /** Post-journey state for users who completed 90 days */
  postJourney: PostJourneyState;
  /** User-owned profile used for AI personalization. */
  userProfile: UserProfile;
  /** IANA timezone for the app's day boundary (null = auto/device timezone). */
  timeZone: string | null;
  /** User-created / edited habits. Overrides seed habits by id (same pattern as dynamicTaskBank). */
  customHabits: Habit[];
  /** Advanced curriculum controls (add/edit/delete/import/export). */
  curriculumEditing: boolean;
  /** Uploaded study planners per subject (PCM + custom), readable by the AI. */
  subjectPlanners: SubjectPlanner[];
  /** Whether the structured 90-day track & levels map is active (true), or flexible daily planner mode (false). */
  enable90DayTrack: boolean;
  /** When 90-day track is paused, store the exact day number to resume from. */
  pausedTrackDay?: number;
  /** Custom user/AI daily to-dos. */
  customTodos: CustomTodoTask[];
  /** Study resource library (PDFs, Notes, Formula sheets). */
  studyVault: StudyResource[];
}

export function defaultAiSettings(): AiSettings {
  return { 
    providers: {}, 
    activeProviderId: null, 
    modelCache: {}, 
    aiEnabled: true,
    chat: defaultChatSettings(),
    websearch: defaultWebSearchSettings(),
  };
}

export function emptyAppState(): AppState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    startDateISO: null,
    bonusDaysUsed: 0,
    taskLogs: {},
    weeklyReviews: [],
    monthlyAssessments: [],
    failureLog: [],
    examDateISO: null,
    clearedLevels: [],
    memory: { entries: [], summaries: [], lastSummarizedAt: null },
    summaries: [],
    aiSettings: defaultAiSettings(),
    dynamicTaskBank: [],
    restDays: [],
    testDays: [],
    masteryPlacement: {},
    planCache: {},
    studyTimeMinutes: 360,
    aiActionHistory: emptyAiActionHistory(),
    lastSummaryDate: null,
    postJourney: defaultPostJourney(),
    userProfile: defaultUserProfile(),
    timeZone: null,
    customHabits: [],
    curriculumEditing: false,
    subjectPlanners: [],
    enable90DayTrack: true,
    customTodos: [],
    studyVault: [],
  };
}
