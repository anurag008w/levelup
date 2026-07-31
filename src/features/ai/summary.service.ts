import type { AppState } from '../../core/domain/state';
import type { DailySummary } from '../../core/domain/summary';
import type { DailyPlan } from '../../core/domain/progress';
import { DEFAULT_PROGRESSION_CONFIG, type ProgressionConfig } from '../../core/domain/progress';
import type { Level } from '../../core/domain/habit';
import type { HabitRepository } from '../../core/ports/repositories';
import type { Clock } from '../../core/ports/clock';
import type { HabitProgressionService } from '../habit-engine/planner';
import type { LLMService } from './llm.service';
import type { MemoryService } from './memory.service';

export interface SummaryServiceDeps {
  planner: HabitProgressionService;
  habits: HabitRepository;
  levels: Level[];
  totalDays: number;
  clock: Clock;
  memory: MemoryService;
  /** Optional — when null the summary runs fully deterministic. */
  llm: LLMService | null;
}

const SKILL_WEIGHTS: Record<string, number> = {
  planning: 0.9,
  focus: 0.7,
  discipline: 0.8,
  recall: 0.8,
  analysis: 0.9,
  reasoning: 1.0,
  verification: 0.7,
  reflection: 0.8,
  systems: 0.6,
  creativity: 0.6,
};

/**
 * End-of-day summary pipeline (M6). Computes deterministic scores from the
 * day's plan + log, then — when a provider is available — enriches with short
 * AI observations. Never blocks on AI: failures degrade to aiFallback.
 */
export class DailySummaryService {
  private readonly deps: SummaryServiceDeps;

  constructor(deps: SummaryServiceDeps) {
    this.deps = deps;
  }

  async build(state: AppState, dateISO: string, config: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG): Promise<DailySummary> {
    const plan = this.deps.planner.buildPlan(state, dateISO, config);
    const summary = this.computeDeterministic(state, dateISO, plan, config, []);
    return this.enrichWithAi(state, summary, plan, config);
  }

  async runDailyPipeline(state: AppState, dateISO: string, config: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG): Promise<AppState> {
    const summary = await this.build(state, dateISO, config);
    const next: AppState = {
      ...state,
      summaries: [...state.summaries.filter((s) => s.dateISO !== dateISO), summary],
      lastSummaryDate: dateISO,
    };
    let memState = this.deps.memory.add(next, {
      type: 'progression',
      source: 'system',
      content: `Day ${nextPlanDayNumber(state, dateISO)}: productivity ${summary.productivityScore}, thinking ${summary.thinkingScore}, streak ${summary.streak}.`,
      importance: 0.7,
      tags: ['daily-summary'],
    });
    if (summary.aiObservations.length > 0) {
      memState = this.deps.memory.add(memState, {
        type: 'observation',
        source: 'ai',
        content: summary.aiObservations.join(' | '),
        importance: 0.8,
        tags: ['ai-observation'],
      });
    }
    return memState;
  }

  private computeDeterministic(
    state: AppState,
    dateISO: string,
    plan: DailyPlan,
    config: ProgressionConfig,
    journalInsights: string[],
  ): DailySummary {
    const context = this.deps.planner.buildContext(state, dateISO, config);
    const completed: string[] = [];
    const missed: string[] = [];
    const habitDone = new Map<string, { done: number; total: number }>();
    const revisionCompleted: string[] = [];
    let doneMinutes = 0;
    let requiredMinutes = 0;

    for (const task of plan.tasks) {
      const log = state.taskLogs[task.logKey] ?? {};
      const done = Boolean(log[task.entry.id]);
      const duration = task.entry.estimatedDurationMin;
      if (task.required) requiredMinutes += duration;
      if (done) {
        completed.push(task.entry.id);
        doneMinutes += duration;
        if (task.entry.taskType === 'Review') revisionCompleted.push(task.entry.id);
      } else {
        missed.push(task.entry.id);
      }
      if (task.entry.habitId) {
        const acc = habitDone.get(task.entry.habitId) ?? { done: 0, total: 0 };
        acc.total += 1;
        if (done) acc.done += 1;
        habitDone.set(task.entry.habitId, acc);
      }
    }

    const habitProgress: Record<string, number> = {};
    for (const [habitId, acc] of habitDone) {
      habitProgress[habitId] = Math.round((acc.done / acc.total) * 100);
    }

    const thinkingScore = this.thinkingScore(completedTaskEntries(plan, state.taskLogs));
    const productivityScore = Math.min(
      100,
      requiredMinutes > 0
        ? Math.round((doneMinutes / requiredMinutes) * 100)
        : plan.tasks.length > 0
          ? Math.round((doneMinutes / plan.tasks.reduce((s, p) => s + p.entry.estimatedDurationMin, 0)) * 100)
          : 0,
    );

    const backlogCleared = completed.filter((id) => {
      const entry = this.deps.planner.stats.baseTasksForDay(plan.dayNumber).find((t) => t.id === id);
      return entry ? entry.backlogSuitability >= 0.7 : false;
    }).length;

    return {
      id: uid(),
      dateISO,
      completedTaskIds: completed,
      missedTaskIds: missed,
      habitProgress,
      streak: context.streak,
      weakHabitIds: context.weakHabitIds,
      strongHabitIds: context.strongHabitIds,
      revisionCompletedIds: revisionCompleted,
      backlogStatus: { count: context.backlogDays, cleared: backlogCleared },
      journalInsights,
      aiObservations: [],
      thinkingScore,
      productivityScore,
      planForTomorrow: this.planForTomorrow(context.weakHabitIds, context.revisionDueHabitIds, context.backlogDays, context.gapDays, this.deps.habits),
      gapsDetected: context.gapDays,
      aiFallback: true,
      createdAt: new Date().toISOString(),
    };
  }

  private async enrichWithAi(state: AppState, summary: DailySummary, plan: DailyPlan, config: ProgressionConfig): Promise<DailySummary> {
    const llm = this.deps.llm;
    if (!llm || !llm.isAvailable()) return summary;
    const prompt = this.buildObservationPrompt(state, summary, plan, config);
    try {
      const res = await llm.complete({
        messages: [
          { role: 'system', content: 'You are the daily coach of a JEE aspirant app. Respond with JSON only: {"observations": ["..."], "planForTomorrow": ["..."]}. Each list has 2-3 short items (max 12 words each).' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 300,
        temperature: 0.4,
      });
      const parsed = parseObservations(res.text);
      if (parsed.observations.length === 0 && parsed.planForTomorrow.length === 0) return summary;
      return {
        ...summary,
        aiObservations: parsed.observations.length > 0 ? parsed.observations : summary.aiObservations,
        planForTomorrow: parsed.planForTomorrow.length > 0 ? parsed.planForTomorrow : summary.planForTomorrow,
        aiFallback: false,
      };
    } catch {
      return summary;
    }
  }

  private thinkingScore(completed: Array<{ thinkingSkills: string[] }>): number {
    const scores: number[] = [];
    for (const task of completed) {
      const weights = task.thinkingSkills.map((s) => SKILL_WEIGHTS[s] ?? 0.5);
      if (weights.length > 0) scores.push(Math.max(...weights));
    }
    if (scores.length === 0) return 0;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
  }

  private planForTomorrow(
    weakHabitIds: string[],
    revisionDueHabitIds: string[],
    backlogDays: number,
    gapDays: number,
    habits: HabitRepository,
  ): string[] {
    const out: string[] = [];
    const habitName = (id: string) => habits.getHabitById(id)?.name ?? id;
    for (const id of weakHabitIds.slice(0, 2)) {
      out.push(`Revise ${habitName(id)} basics with a light session`);
    }
    for (const id of revisionDueHabitIds.slice(0, 2)) {
      out.push(`Complete pending revision for ${habitName(id)}`);
    }
    if (backlogDays >= 3) out.push(`Clear ${backlogDays}-day backlog with a recovery session`);
    if (gapDays >= 2) out.push('Rebuild momentum: morning core habits only');
    return out.slice(0, 4);
  }

  private buildObservationPrompt(state: AppState, summary: DailySummary, plan: DailyPlan, config: ProgressionConfig): string {
    const context = this.deps.planner.buildContext(state, plan.dateISO, config);
    const habits = this.deps.habits
      .getAllHabits()
      .filter((h) => context.unlockedHabitIds.includes(h.id))
      .slice(0, 8)
      .map((h) => `${h.name} (${h.id})`);
    return [
      `Day ${plan.dayNumber} for a JEE aspirant.`,
      `Streak: ${summary.streak}. Productivity: ${summary.productivityScore}/100. Thinking: ${summary.thinkingScore}/100.`,
      `Completed: ${summary.completedTaskIds.length}/${summary.completedTaskIds.length + summary.missedTaskIds.length}.`,
      `Weak habits: ${summary.weakHabitIds.join(', ') || 'none'}.`,
      `Strong habits: ${summary.strongHabitIds.join(', ') || 'none'}.`,
      `Backlog days: ${summary.backlogStatus.count}. Gaps detected: ${summary.gapsDetected}.`,
      `Unlocked habits: ${habits.join(', ')}.`,
      'Give honest, concise coaching observations and one concrete plan for tomorrow.',
    ].join('\n');
  }
}

function parseObservations(text: string): { observations: string[]; planForTomorrow: string[] } {
  const json = extractJson(text);
  if (json) {
    const data = json as { observations?: unknown; planForTomorrow?: unknown };
    const observations = toStrArray(data.observations);
    const planForTomorrow = toStrArray(data.planForTomorrow);
    return { observations, planForTomorrow };
  }
  // Fallback: treat each non-empty line as an observation.
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return { observations: lines, planForTomorrow: [] };
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

function completedTaskEntries(plan: DailyPlan, taskLogs: AppState['taskLogs']): Array<{ thinkingSkills: string[] }> {
  const out: Array<{ thinkingSkills: string[] }> = [];
  for (const task of plan.tasks) {
    const log = taskLogs[task.logKey] ?? {};
    if (log[task.entry.id]) out.push({ thinkingSkills: task.entry.thinkingSkills });
  }
  return out;
}

function nextPlanDayNumber(state: AppState, dateISO: string): number {
  if (!state.startDateISO) return 0;
  const start = new Date(state.startDateISO + 'T00:00:00').getTime();
  const day = new Date(dateISO + 'T00:00:00').getTime();
  return Math.floor((day - start) / 86400000) + 1;
}

function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `sum-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
