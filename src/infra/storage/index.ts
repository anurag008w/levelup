/**
 * Storage Exports
 */

export { persistentStorage, BrowserStorage, persistentStore, ModelCacheRepositoryImpl } from './local-storage';
export { LocalChatRepository, CHAT_STORAGE_KEY } from './chat-repository';
export {
  userStorage,
  persistentStorage as storage,
  getUserProgress,
  saveUserProgress,
  getAISettings,
  saveAISettings,
  getAppSettings,
  saveAppSettings,
  updateStudyStreak,
  addXP,
  recordQuestionAttempt,
  getAccuracy,
  STORAGE_KEYS,
  type UserProgress,
  type AISettings,
  type AppSettings,
  type OnboardingState,
} from './user-storage';
