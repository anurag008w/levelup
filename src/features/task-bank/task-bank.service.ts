import type { TaskBankEntry, Slot, PhaseId, TaskType, EnergyLevel, Difficulty, ThinkingSkill } from '../../core/domain/task-bank';
import type { TaskBankRepository } from '../../core/ports/repositories';
import { SLOT_ORDER } from '../../core/domain/task-bank';

/** Lightweight, pure snapshot of the world used to evaluate unlock conditions. */
export interface UnlockSnapshot {
  dayNumber: number;
  phase: PhaseId;
  unlockedHabitIds: string[];
  examWindowActive: boolean;
  mockSunday: boolean;
  /** Actual calendar weekday (0=Sunday..6=Saturday) of the planned date. */
  weekday: number;
  recoveryMode: boolean;
  backlogDays: number;
  revisionDueHabitIds: string[];
}

export interface TaskSearchQuery {
  ids?: string[];
  excludeIds?: string[];
  habitIds?: string[];
  phases?: PhaseId[];
  taskTypes?: TaskType[];
  slots?: Slot[];
  minDifficulty?: Difficulty;
  maxDifficulty?: Difficulty;
  maxDurationMin?: number;
  energyLevels?: EnergyLevel[];
  tags?: string[];
  thinkingSkills?: ThinkingSkill[];
  revisionOnly?: boolean;
  backlogOnly?: boolean;
  /** When provided, only entries whose unlock conditions all pass are returned. */
  unlock?: UnlockSnapshot;
  activeOnly?: boolean;
  limit?: number;
}

export function isUnlockMet(entry: TaskBankEntry, snapshot: UnlockSnapshot): boolean {
  for (const cond of entry.unlockConditions) {
    switch (cond.type) {
      case 'day':
        if (snapshot.dayNumber < cond.fromDay) return false;
        break;
      case 'day-exact':
        if (snapshot.dayNumber !== cond.day) return false;
        break;
      case 'not-day':
        if (snapshot.dayNumber === cond.day) return false;
        break;
      case 'phase':
        if (snapshot.phase !== cond.phase) return false;
        break;
      case 'habit':
        if (!snapshot.unlockedHabitIds.includes(cond.habitId)) return false;
        break;
      case 'exam-window':
        if (!snapshot.examWindowActive) return false;
        break;
      case 'mock-sunday':
        if (!snapshot.mockSunday) return false;
        break;
      case 'weekday':
        if (!cond.days.includes(snapshot.weekday)) return false;
        break;
      case 'day-in':
        if (!cond.days.includes(snapshot.dayNumber)) return false;
        break;
      case 'recovery':
        if (!snapshot.recoveryMode) return false;
        break;
      case 'backlog':
        if (snapshot.backlogDays < cond.thresholdDays) return false;
        break;
      case 'revision':
        // Revision tasks target habits whose revision is currently due.
        if (!snapshot.revisionDueHabitIds.includes(entry.habitId)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** Pure search/filter over bank entries. Deterministic ordering. */
export function searchBank(entries: TaskBankEntry[], query: TaskSearchQuery): TaskBankEntry[] {
  const {
    ids,
    excludeIds,
    habitIds,
    phases,
    taskTypes,
    slots,
    minDifficulty,
    maxDifficulty,
    maxDurationMin,
    energyLevels,
    tags,
    thinkingSkills,
    revisionOnly,
    backlogOnly,
    unlock,
    activeOnly = true,
    limit,
  } = query;

  const exclude = new Set(excludeIds ?? []);
  const idSet = ids ? new Set(ids) : null;
  const habitSet = habitIds ? new Set(habitIds) : null;
  const phaseSet = phases ? new Set(phases) : null;
  const typeSet = taskTypes ? new Set(taskTypes) : null;
  const slotSet = slots ? new Set(slots) : null;
  const energySet = energyLevels ? new Set(energyLevels) : null;
  const tagSet = tags ? new Set(tags) : null;
  const skillSet = thinkingSkills ? new Set(thinkingSkills) : null;

  const results: TaskBankEntry[] = [];
  for (const entry of entries) {
    if (activeOnly && !entry.active) continue;
    if (exclude.has(entry.id)) continue;
    if (idSet && !idSet.has(entry.id)) continue;
    if (habitSet && !habitSet.has(entry.habitId)) continue;
    if (phaseSet && !phaseSet.has(entry.phase)) continue;
    if (typeSet && !typeSet.has(entry.taskType)) continue;
    if (slotSet && !(entry.legacy && slotSet.has(entry.legacy.slot))) continue;
    if (minDifficulty !== undefined && entry.difficulty < minDifficulty) continue;
    if (maxDifficulty !== undefined && entry.difficulty > maxDifficulty) continue;
    if (maxDurationMin !== undefined && entry.estimatedDurationMin > maxDurationMin) continue;
    if (energySet && !energySet.has(entry.energyLevel)) continue;
    if (tagSet && !entry.tags.some((t) => tagSet.has(t))) continue;
    if (skillSet && !entry.thinkingSkills.some((s) => skillSet.has(s))) continue;
    if (revisionOnly && entry.taskType !== 'Review' && entry.revisionSuitability < 0.7) continue;
    if (backlogOnly && entry.taskType !== 'Recovery' && entry.backlogSuitability < 0.7) continue;
    if (unlock && !isUnlockMet(entry, unlock)) continue;
    results.push(entry);
  }
  return limit !== undefined ? results.slice(0, limit) : results;
}

export interface TaskBankService {
  getAll(): TaskBankEntry[];
  getById(id: string): TaskBankEntry | undefined;
  search(query: TaskSearchQuery): TaskBankEntry[];
  findByLevel(levelId: number): TaskBankEntry[];
  /** Tasks whose legacy slot matches — used to reproduce the historical layout. */
  findBySlot(slot: Slot): TaskBankEntry[];
  /** Persist a dynamic (AI/custom) entry so it joins future plans once unlocked. */
  saveDynamicEntry(entry: TaskBankEntry): void;
}

export class TaskBankServiceImpl implements TaskBankService {
  private readonly repository: TaskBankRepository;

  constructor(repository: TaskBankRepository) {
    this.repository = repository;
  }

  getAll(): TaskBankEntry[] {
    return this.repository.getAll();
  }

  getById(id: string): TaskBankEntry | undefined {
    return this.repository.getById(id);
  }

  search(query: TaskSearchQuery): TaskBankEntry[] {
    return searchBank(this.repository.getAll(), query);
  }

  findByLevel(levelId: number): TaskBankEntry[] {
    return this.repository
      .getAll()
      .filter((t) => t.legacy?.levelId === levelId)
      .sort((a, b) => slotRank(a) - slotRank(b) || (a.legacy?.order ?? 0) - (b.legacy?.order ?? 0));
  }

  findBySlot(slot: Slot): TaskBankEntry[] {
    return this.repository.getAll().filter((t) => t.legacy?.slot === slot);
  }

  saveDynamicEntry(entry: TaskBankEntry): void {
    this.repository.saveEntry(entry);
  }
}

function slotRank(t: TaskBankEntry): number {
  if (!t.legacy) return SLOT_ORDER.length;
  return SLOT_ORDER.indexOf(t.legacy.slot);
}
