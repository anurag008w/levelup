import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { Habit } from '../../core/domain/habit';
import type { TaskBankRepository, HabitRepository, StateRepository } from '../../core/ports/repositories';
import { validateSeed } from './validation';

import seedTasks from './seed/tasks.json';
import seedHabits from './seed/habits.json';

export interface SeedBundle {
  tasks: TaskBankEntry[];
  habits: Habit[];
}

/** Validates seed payloads once at startup. */
export function buildSeed(): SeedBundle {
  const report = validateSeed(
    (seedTasks as { tasks: unknown[] }).tasks,
    (seedHabits as { habits: unknown[] }).habits,
  );
  if (report.invalidTasks.length > 0 || report.invalidHabits.length > 0) {
    console.warn(
      `[task-bank] ignored ${report.invalidTasks.length} invalid tasks and ${report.invalidHabits.length} invalid habits`,
    );
  }
  return { tasks: report.validTasks, habits: report.validHabits };
}

export class TaskBankRepositoryImpl implements TaskBankRepository, HabitRepository {
  private readonly seed: SeedBundle;
  private readonly stateRepository: StateRepository;

  constructor(stateRepository: StateRepository, seed?: SeedBundle) {
    this.stateRepository = stateRepository;
    this.seed = seed ?? buildSeed();
  }

  private dynamicEntries(): TaskBankEntry[] {
    return this.stateRepository.load().dynamicTaskBank;
  }

  getAll(): TaskBankEntry[] {
    const byId = new Map<string, TaskBankEntry>();
    for (const entry of this.seed.tasks) byId.set(entry.id, entry);
    for (const entry of this.dynamicEntries()) byId.set(entry.id, entry);
    return [...byId.values()];
  }

  getById(id: string): TaskBankEntry | undefined {
    return this.getAll().find((t) => t.id === id);
  }

  saveEntry(entry: TaskBankEntry): void {
    const state = this.stateRepository.load();
    const next = state.dynamicTaskBank.filter((e) => e.id !== entry.id);
    next.push(entry);
    this.stateRepository.save({ ...state, dynamicTaskBank: next });
  }

  replaceDynamic(entries: TaskBankEntry[]): void {
    const state = this.stateRepository.load();
    this.stateRepository.save({ ...state, dynamicTaskBank: entries });
  }

  getAllHabits(): Habit[] {
    return this.seed.habits;
  }

  getHabitById(id: string): Habit | undefined {
    return this.seed.habits.find((h) => h.id === id);
  }

  getHabitsByLevel(levelId: number): Habit[] {
    return this.seed.habits.filter((h) => h.levelId === levelId);
  }
}
