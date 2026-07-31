import type { AppState } from '../domain/state';
import type { TaskBankEntry } from '../domain/task-bank';
import type { Habit } from '../domain/habit';
import type { ModelInfo } from '../domain/llm';
import type { ChatStoreState } from '../domain/chat';

// Persistence ports. Implementations live in infra/storage and are injected.

export interface StateRepository {
  load(): AppState;
  save(state: AppState): void;
  clear(): void;
}

/** Read/write handle with an in-memory copy; preferred by services. */
export interface StateStore {
  get(): AppState;
  save(state: AppState): void;
}

export interface TaskBankRepository {
  /** All active + inactive entries (static seed merged with dynamic bank). */
  getAll(): TaskBankEntry[];
  getById(id: string): TaskBankEntry | undefined;
  /** Persist an AI-generated / user-created task into the dynamic bank. */
  saveEntry(entry: TaskBankEntry): void;
  /** Replace the whole dynamic bank (e.g. after removal). */
  replaceDynamic(entries: TaskBankEntry[]): void;
}

export interface HabitRepository {
  getAllHabits(): Habit[];
  getHabitById(id: string): Habit | undefined;
  getHabitsByLevel(levelId: number): Habit[];
}

export interface ModelCacheRepository {
  get(providerId: string): ModelInfo[] | null;
  set(providerId: string, models: ModelInfo[]): void;
  clear(providerId: string): void;
}

export interface KeyValueRepository {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ChatRepository {
  load(): ChatStoreState;
  save(state: ChatStoreState): void;
}
