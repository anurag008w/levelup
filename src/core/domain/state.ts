import type { MemoryStore } from './memory';
import type { DailySummary } from './summary';
import type { DailyPlan } from './progress';
import type { ProviderConfig, ModelInfo, ThinkingLevel } from './llm';
import type { TaskBankEntry } from './task-bank';
import type { AiActionHistoryState } from './ai-actions';
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
}

export function defaultAiSettings(): AiSettings {
  return { 
    providers: {}, 
    activeProviderId: null, 
    modelCache: {}, 
    aiEnabled: true,
    chat: defaultChatSettings(),
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
    planCache: {},
    studyTimeMinutes: 360,
    aiActionHistory: emptyAiActionHistory(),
    lastSummaryDate: null,
    postJourney: defaultPostJourney(),
    userProfile: defaultUserProfile(),
    timeZone: null,
  };
}
