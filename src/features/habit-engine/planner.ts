import type { AppState } from '../../core/domain/state';
import type { DailyPlan, PlannedTask, PlanningContext, ProgressionConfig, PlanSource } from '../../core/domain/progress';
import type { Level } from '../../core/domain/habit';
import type { TaskBankEntry, Slot } from '../../core/domain/task-bank';
import type { HabitRepository } from '../../core/ports/repositories';
import type { TaskBankService, UnlockSnapshot } from '../task-bank/task-bank.service';
import { isUnlockMet } from '../task-bank/task-bank.service';
import { rankCandidates } from '../task-bank/ranking';
import { HabitStatsService } from './habits';
import { buildPlanningContext } from './context';
import { SLOT_ORDER } from '../../core/domain/task-bank';

export interface PlannerDeps {
  taskBank: TaskBankService;
  habits: HabitRepository;
  levels: Level[];
  totalDays: number;
}

/**
 * The Habit Progression Engine. Builds a deterministic daily plan from the
 * Task Bank + persisted context. Never randomly chooses tasks.
 *
 * Backward compatibility: with a healthy context the plan is byte-for-byte the
 * legacy cumulative task list (same ids, same slots, same order).
 */
export class HabitProgressionService {
  readonly stats: HabitStatsService;
  private readonly deps: PlannerDeps;

  constructor(deps: PlannerDeps) {
    this.deps = deps;
    this.stats = new HabitStatsService(deps.taskBank, deps.habits);
  }

  buildContext(state: AppState, dateISO: string, config: ProgressionConfig): PlanningContext {
    return buildPlanningContext(state, dateISO, config, {
      stats: this.stats,
      habits: this.deps.habits,
      levels: this.deps.levels,
      totalDays: this.deps.totalDays,
    });
  }

  buildPlan(state: AppState, dateISO: string, config: ProgressionConfig): DailyPlan {
    const context = this.buildContext(state, dateISO, config);
    return this.planFromContext(context, config);
  }

  planFromContext(context: PlanningContext, config: ProgressionConfig): DailyPlan {
    // Rest/holiday day: no auto curriculum and no AI injection. Only tasks the
    // user explicitly scheduled for this exact day (day-exact) are planned, so
    // "chhuti" days stay light unless study was deliberately requested.
    if (context.restDay) {
      const planned: PlannedTask[] = [];
      this.injectDynamic(context, planned);
      this.injectScheduledMastered(context, planned);
      return this.finalize(context, planned, config);
    }

    const snapshot = this.snapshotFromContext(context);
    const candidates = this.deps.taskBank.search({ unlock: snapshot, activeOnly: true });

    // Base plan: everything that historically lived in a level, plus protocol
    // tasks whose cadence matches today (mock Sundays / exam window).
    // Mastered tasks are excluded from the daily rotation (completed bucket).
    const base = candidates.filter((t) => t.legacy !== undefined && !context.masteredTaskIds.has(t.id));
    const planned: PlannedTask[] = base.map((entry) => ({
      entry,
      source: 'bank',
      reason: 'curriculum',
      slot: this.slotOf(entry),
      group: this.groupOf(entry, true),
      required: !context.recoveryMode,
      score: 0,
      logKey: this.logKeyFor(entry, context.dateISO),
    }));

    // Explicit custom/AI tasks: always part of the plan once their day unlocks,
    // shown in their natural slot (never hidden behind weak/revision heuristics).
    this.injectDynamic(context, planned);

    // Mastered tasks the user deliberately scheduled for today.
    this.injectScheduledMastered(context, planned);

    // Recovery mode: only the current level's tasks are required.
    if (context.recoveryMode) {
      const currentLevel = context.dayNumber === 0 ? null : this.levelForDay(context.dayNumber);
      const coreIds = new Set(
        this.deps.taskBank
          .findByLevel(currentLevel?.id ?? 0)
          .map((t) => t.id),
      );
      for (const task of planned) {
        task.required = coreIds.has(task.entry.id);
        task.group = this.groupOf(task.entry, task.required);
      }
      // Gently re-enter with a recovery task when the user is recovering.
      this.injectRecoveryTasks(context, config, planned);
      return this.finalize(context, planned, config);
    }

    // Progression intelligence: weak habits, revision, backlog and gaps.
    this.injectIntelligence(context, config, planned);

    return this.finalize(context, planned, config);
  }

  private injectRecoveryTasks(context: PlanningContext, config: ProgressionConfig, planned: PlannedTask[]) {
    const snapshot = this.snapshotFromContext(context);
    const existing = new Set(planned.map((p) => p.entry.id));
    const recoveryCandidates = this.deps.taskBank
      .search({ unlock: snapshot, activeOnly: true, taskTypes: ['Recovery'] })
      .filter((t) => !existing.has(t.id) && t.unlockConditions.some((c) => c.type === 'recovery'));
    const ranked = rankCandidates(recoveryCandidates, {
      dayNumber: context.dayNumber,
      weakHabitIds: context.weakHabitIds,
      revisionDueHabitIds: [],
      backlogDays: context.backlogDays,
      remainingMinutes: context.availableMinutes,
      recentTaskIds: new Set(),
      gapDays: context.gapDays,
      recoveryMode: true,
    });
    const toAdd = ranked.slice(0, Math.min(2, config.maxInjectedTasks));
    for (const r of toAdd) {
      // Recovery tasks stay required so they show up with the core tasks
      // (top of the plan), not buried in the optional bonus group.
      planned.push(this.toPlanned(r.entry, context, 'bank', `recovery: ${r.reason}`, true, r.score));
    }
  }

  private injectIntelligence(context: PlanningContext, config: ProgressionConfig, planned: PlannedTask[]) {
    if (!config.aiEnabled) return;
    const existing = new Set(planned.map((p) => p.entry.id));
    const snapshot = this.snapshotFromContext(context);

    let remaining = context.availableMinutes - planned.reduce((sum, p) => sum + p.entry.estimatedDurationMin, 0);
    if (remaining <= 0) return;

    const injectedIds = new Set<string>();
    let budget = Math.min(config.maxInjectedTasks, Math.floor(remaining / 10));

    const candidates: TaskBankEntry[] = [];

    // Weak habits → gentle review/recovery tasks for that habit.
    const weakTargets = new Set(
      this.deps.taskBank
        .search({ unlock: snapshot, activeOnly: true })
        .filter((t) => !context.masteredTaskIds.has(t.id) && context.weakHabitIds.includes(t.habitId) && (t.taskType === 'Review' || t.taskType === 'Recovery' || t.taskType === 'Reflection'))
        .filter((t) => !existing.has(t.id) && !injectedIds.has(t.id))
        .map((t) => t.id),
    );
    // Revision schedule → review tasks for habits with due revision.
    for (const t of this.deps.taskBank.search({ unlock: snapshot, activeOnly: true })) {
      if (existing.has(t.id) || injectedIds.has(t.id)) continue;
      if (context.masteredTaskIds.has(t.id)) continue;
      const isRevision = context.revisionDueHabitIds.includes(t.habitId) && (t.taskType === 'Review' || t.revisionSuitability >= 0.7);
      const isBacklog = context.backlogDays >= config.backlogThresholdDays && (t.taskType === 'Recovery' || t.backlogSuitability >= 0.7);
      if (isRevision || isBacklog || weakTargets.has(t.id)) candidates.push(t);
    }

    const ranked = rankCandidates(candidates, {
      dayNumber: context.dayNumber,
      weakHabitIds: context.weakHabitIds,
      revisionDueHabitIds: context.revisionDueHabitIds,
      backlogDays: context.backlogDays,
      remainingMinutes: remaining,
      recentTaskIds: context.completedTaskIds,
      gapDays: context.gapDays,
      recoveryMode: context.recoveryMode,
    });

    for (const r of ranked) {
      if (budget <= 0) break;
      const cost = r.entry.estimatedDurationMin;
      if (cost > remaining) continue;
      planned.push(this.toPlanned(r.entry, context, 'bank', `recommended: ${r.reason}`, false, r.score));
      injectedIds.add(r.entry.id);
      remaining -= cost;
      budget--;
    }  }

  private injectDynamic(context: PlanningContext, planned: PlannedTask[]) {
    if (context.dynamicEntries.length === 0) return;
    const snapshot = this.snapshotFromContext(context);
    const existing = new Set(planned.map((p) => p.entry.id));
    for (const entry of context.dynamicEntries) {
      if (!entry.active) continue;
      if (existing.has(entry.id)) continue;
      if (context.masteredTaskIds.has(entry.id)) continue;
      if (!isUnlockMet(entry, snapshot)) continue;
      const slot = this.slotOf(entry);
      planned.push({
        entry,
        source: 'ai',
        reason: 'custom',
        slot,
        group: slot,
        required: false,
        score: 1,
        logKey: this.logKeyFor(entry, context.dateISO),
      });
    }
  }

  /** Mastered tasks the user scheduled for today re-enter the plan. */
  private injectScheduledMastered(context: PlanningContext, planned: PlannedTask[]) {
    if (context.scheduledMasteredEntries.length === 0) return;
    const existing = new Set(planned.map((p) => p.entry.id));
    for (const entry of context.scheduledMasteredEntries) {
      if (existing.has(entry.id)) continue;
      const slot = this.slotOf(entry);
      planned.push({
        entry,
        source: 'ai',
        reason: 'scheduled',
        slot,
        group: slot,
        required: true,
        score: 1,
        logKey: this.logKeyFor(entry, context.dateISO),
      });
    }
  }

  private toPlanned(
    entry: TaskBankEntry,
    context: PlanningContext,
    source: PlanSource,
    reason: string,
    required: boolean,
    score: number,
  ): PlannedTask {
    return {
      entry,
      source,
      reason,
      slot: this.slotOf(entry),
      group: this.groupOf(entry, required),
      required,
      score,
      logKey: this.logKeyFor(entry, context.dateISO),
    };
  }

  private finalize(context: PlanningContext, planned: PlannedTask[], config: ProgressionConfig): DailyPlan {
    planned.sort((a, b) => {
      // Recovery mode: required (core) tasks first.
      if (a.required !== b.required) return a.required ? -1 : 1;
      const la = a.entry.legacy;
      const lb = b.entry.legacy;
      // Backward compatibility: the base plan is ordered by level then order,
      // exactly like the legacy curriculum lists.
      if (la && lb) return la.levelId - lb.levelId || la.order - lb.order;
      if (la && !lb) return -1;
      if (!la && lb) return 1;
      // Non-legacy (injected) tasks: slot, then score, then id for stability.
      const slotRank = (slot: Slot) => SLOT_ORDER.indexOf(slot);
      const slotDiff = slotRank(a.slot) - slotRank(b.slot);
      if (slotDiff !== 0) return slotDiff;
      return b.score - a.score || a.entry.id.localeCompare(b.entry.id);
    });

    const usedMinutes = planned.reduce((sum, p) => sum + p.entry.estimatedDurationMin, 0);
    return {
      dateISO: context.dateISO,
      dayNumber: context.dayNumber,
      tasks: planned,
      generatedAt: new Date().toISOString(),
      generationStrategy: 'bank',
      contextSummary: this.summarizeContext(context, planned.length, usedMinutes, config),
    };
  }

  private summarizeContext(context: PlanningContext, taskCount: number, usedMinutes: number, config: ProgressionConfig): string {
    const parts: string[] = [`day ${context.dayNumber}`, `${taskCount} tasks`, `${usedMinutes}min`];
    if (context.streak > 0) parts.push(`streak ${context.streak}`);
    if (context.weakHabitIds.length > 0) parts.push(`weak: ${context.weakHabitIds.length}`);
    if (context.strongHabitIds.length > 0) parts.push(`strong: ${context.strongHabitIds.length}`);
    if (context.backlogDays >= config.backlogThresholdDays) parts.push(`backlog ${context.backlogDays}`);
    if (context.revisionDueHabitIds.length > 0) parts.push(`revision ${context.revisionDueHabitIds.length}`);
    if (context.gapDays > 0) parts.push(`gap ${context.gapDays}`);
    if (context.recoveryMode) parts.push('recovery');
    if (context.restDay) parts.push('rest-day');
    if (context.examWindowActive) parts.push('exam-window');
    return parts.join(' · ');
  }

  private slotOf(entry: TaskBankEntry): Slot {
    if (entry.legacy) return entry.legacy.slot;
    if (entry.taskType === 'Reflection') return 'night';
    if (entry.taskType === 'Review') return 'night';
    return 'blocks';
  }

  private groupOf(entry: TaskBankEntry, required: boolean): PlannedTask['group'] {
    const has = (type: string) => entry.unlockConditions.some((c) => c.type === type);
    if (has('mock-sunday')) return 'mock';
    if (has('exam-window')) return 'exam';
    if (!required) return 'bonus';
    if (entry.legacy) return entry.legacy.slot;
    return this.slotOf(entry);
  }

  private logKeyFor(entry: TaskBankEntry, dateISO: string): string {
    const has = (type: string) => entry.unlockConditions.some((c) => c.type === type);
    if (has('mock-sunday')) return `mock:${dateISO}`;
    if (has('exam-window')) return `exam:${dateISO}`;
    return dateISO;
  }

  private snapshotFromContext(context: PlanningContext): UnlockSnapshot {
    return {
      dayNumber: context.dayNumber,
      phase: context.phase,
      unlockedHabitIds: context.unlockedHabitIds,
      examWindowActive: context.examWindowActive,
      mockSunday: context.mockSunday,
      weekday: context.weekday,
      recoveryMode: context.recoveryMode,
      backlogDays: context.backlogDays,
      revisionDueHabitIds: context.revisionDueHabitIds,
    };
  }

  private levelForDay(dayNumber: number): Level | undefined {
    return this.deps.levels.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd);
  }
}
