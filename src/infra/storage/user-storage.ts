/**
 * User Progress & Settings Storage
 * Persists user data across app updates
 */

import { persistentStorage } from './persistent-storage';
import { deviceTimeZone, isoDateInTimeZone } from '../../core/ports/clock';

// Storage Keys
export const STORAGE_KEYS = {
  USER_PROGRESS: 'user_progress',
  AI_SETTINGS: 'ai_settings',
  APP_SETTINGS: 'app_settings',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  LAST_SYNC: 'last_sync',
} as const;

// Types
export interface UserProgress {
  totalQuestionsAttempted: number;
  correctAnswers: number;
  studyStreak: number;
  lastStudyDate: string | null;
  completedTopics: string[];
  weakAreas: string[];
  strongAreas: string[];
  totalStudyTime: number; // in minutes
  dailyGoal: number;
  todayProgress: number;
  achievements: string[];
  level: number;
  xp: number;
}

export interface AISettings {
  selectedModel: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  conversationHistoryLength: number;
  memoryEnabled: boolean;
  autoSaveChats: boolean;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  soundEnabled: boolean;
  hapticFeedback: boolean;
  autoPlayVideos: boolean;
  offlineMode: boolean;
  language: string;
  fontSize: 'small' | 'medium' | 'large';
}

export interface OnboardingState {
  completed: boolean;
  stepsCompleted: string[];
}

// Default Values
const DEFAULT_USER_PROGRESS: UserProgress = {
  totalQuestionsAttempted: 0,
  correctAnswers: 0,
  studyStreak: 0,
  lastStudyDate: null,
  completedTopics: [],
  weakAreas: [],
  strongAreas: [],
  totalStudyTime: 0,
  dailyGoal: 10,
  todayProgress: 0,
  achievements: [],
  level: 1,
  xp: 0,
};

const DEFAULT_AI_SETTINGS: AISettings = {
  selectedModel: 'gemini-2.0-flash',
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt:
    'LevelUp ki study partner ho — cute, friendly, thodi cheesy; JEE topper (PCM), khud bhi learner. Hinglish me warm, direct reply; formulas LaTeX me. Always first person bolo (main/mujhe/mera), naam tabhi jab user pooche. User Marathi me likhe to Roman Marathi me jawab do.',
  conversationHistoryLength: 10,
  memoryEnabled: true,
  autoSaveChats: true,
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  notifications: true,
  soundEnabled: true,
  hapticFeedback: true,
  autoPlayVideos: true,
  offlineMode: false,
  language: 'en',
  fontSize: 'medium',
};

// User Progress
export async function getUserProgress(): Promise<UserProgress> {
  const progress = await persistentStorage.get<UserProgress>(STORAGE_KEYS.USER_PROGRESS);
  return progress ?? { ...DEFAULT_USER_PROGRESS };
}

export async function saveUserProgress(progress: Partial<UserProgress>): Promise<void> {
  const current = await getUserProgress();
  const updated = { ...current, ...progress };
  await persistentStorage.set(STORAGE_KEYS.USER_PROGRESS, updated);
}

export async function resetUserProgress(): Promise<void> {
  await persistentStorage.set(STORAGE_KEYS.USER_PROGRESS, DEFAULT_USER_PROGRESS);
}

// AI Settings
export async function getAISettings(): Promise<AISettings> {
  const settings = await persistentStorage.get<AISettings>(STORAGE_KEYS.AI_SETTINGS);
  return settings ?? { ...DEFAULT_AI_SETTINGS };
}

export async function saveAISettings(settings: Partial<AISettings>): Promise<void> {
  const current = await getAISettings();
  const updated = { ...current, ...settings };
  await persistentStorage.set(STORAGE_KEYS.AI_SETTINGS, updated);
}

// App Settings
export async function getAppSettings(): Promise<AppSettings> {
  const settings = await persistentStorage.get<AppSettings>(STORAGE_KEYS.APP_SETTINGS);
  return settings ?? { ...DEFAULT_APP_SETTINGS };
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getAppSettings();
  const updated = { ...current, ...settings };
  await persistentStorage.set(STORAGE_KEYS.APP_SETTINGS, updated);
}

// Onboarding
export async function getOnboardingState(): Promise<OnboardingState> {
  const state = await persistentStorage.get<OnboardingState>(STORAGE_KEYS.ONBOARDING_COMPLETED);
  return state ?? { completed: false, stepsCompleted: [] };
}

export async function completeOnboarding(): Promise<void> {
  await persistentStorage.set(STORAGE_KEYS.ONBOARDING_COMPLETED, {
    completed: true,
    stepsCompleted: ['welcome', 'permissions', 'topic-selection'],
  });
}

// Streak Management
export async function updateStudyStreak(): Promise<number> {
  const progress = await getUserProgress();
  const today = isoDateInTimeZone(new Date(), deviceTimeZone());
  const lastDate = progress.lastStudyDate;

  let newStreak = progress.studyStreak;

  if (lastDate === null) {
    newStreak = 1;
  } else {
    const last = new Date(lastDate);
    const now = new Date(today);
    const diffDays = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // Same day, no change
    } else if (diffDays === 1) {
      // Consecutive day
      newStreak = progress.studyStreak + 1;
    } else {
      // Streak broken
      newStreak = 1;
    }
  }

  await saveUserProgress({
    studyStreak: newStreak,
    lastStudyDate: today,
  });

  return newStreak;
}

// XP & Level
export async function addXP(amount: number): Promise<{ level: number; xp: number; leveledUp: boolean }> {
  const progress = await getUserProgress();
  const xpPerLevel = 100;
  let newXP = progress.xp + amount;
  let newLevel = progress.level;
  let leveledUp = false;

  while (newXP >= xpPerLevel) {
    newXP -= xpPerLevel;
    newLevel += 1;
    leveledUp = true;
  }

  await saveUserProgress({ xp: newXP, level: newLevel });

  return { level: newLevel, xp: newXP, leveledUp };
}

// Progress Analytics
export async function recordQuestionAttempt(correct: boolean): Promise<void> {
  const progress = await getUserProgress();
  const today = isoDateInTimeZone(new Date(), deviceTimeZone());

  await saveUserProgress({
    totalQuestionsAttempted: progress.totalQuestionsAttempted + 1,
    correctAnswers: progress.correctAnswers + (correct ? 1 : 0),
    // Track the study day so consecutive same-day attempts accumulate and a
    // new calendar day resets the counter (mirrors updateStudyStreak).
    lastStudyDate: today,
    todayProgress: progress.lastStudyDate === today ? progress.todayProgress + 1 : 1,
  });
}

export async function getAccuracy(): Promise<number> {
  const progress = await getUserProgress();
  if (progress.totalQuestionsAttempted === 0) return 0;
  return Math.round((progress.correctAnswers / progress.totalQuestionsAttempted) * 100);
}

// Export all storage functions
export const userStorage = {
  getUserProgress,
  saveUserProgress,
  resetUserProgress,
  getAISettings,
  saveAISettings,
  getAppSettings,
  saveAppSettings,
  getOnboardingState,
  completeOnboarding,
  updateStudyStreak,
  addXP,
  recordQuestionAttempt,
  getAccuracy,
};

export default userStorage;
