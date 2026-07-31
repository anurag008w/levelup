import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import { DEFAULT_PROGRESSION_CONFIG } from '../../../core/domain/progress';
import { buildSeed, TaskBankRepositoryImpl } from '../../task-bank/task-bank.repository';
import { TaskBankServiceImpl } from '../../task-bank/task-bank.service';
import { HabitProgressionService } from '../../habit-engine/planner';
import { MemoryService } from '../memory.service';
import { DailySummaryService } from '../summary.service';
import { LEVELS, TOTAL_DAYS } from '../../../data/curriculum';
import type { Clock } from '../../../core/ports/clock';

class FixedClock implements Clock {
  private readonly nowISO: string;

  constructor(nowISO: string) {
    this.nowISO = nowISO;
  }

  now(): Date {
    return new Date(this.nowISO + 'T20:00:00');
  }
}

function makeSummaryService(nowISO = '2026-01-08', aiEnabled = false) {
  const repo = new TaskBankRepositoryImpl(
    { load: () => ({ dynamicTaskBank: [] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
    buildSeed(),
  );
  const bank = new TaskBankServiceImpl(repo);
  const planner = new HabitProgressionService({ taskBank: bank, habits: repo, levels: LEVELS, totalDays: TOTAL_DAYS });
  const clock = new FixedClock(nowISO);
  const memory = new MemoryService(clock);
  const config = { ...DEFAULT_PROGRESSION_CONFIG, aiEnabled };
  const service = new DailySummaryService({ planner, habits: repo, levels: LEVELS, totalDays: TOTAL_DAYS, clock, memory, llm: null });
  return { service, planner, config };
}

function isoFromDay(day: number): string {
  const start = new Date('2026-01-01T00:00:00');
  start.setDate(start.getDate() + (day - 1));
  return start.toISOString().slice(0, 10);
}

/** Fills the previous `window` days fully so the day is genuinely healthy. */
function withRecentCompletion(state: AppState, planner: HabitProgressionService, todayDay: number, window = 4): AppState {
  for (let d = Math.max(1, todayDay - window); d < todayDay; d++) {
    const log: Record<string, boolean> = {};
    for (const t of planner.stats.baseTasksForDay(d)) log[t.id] = true;
    state.taskLogs[isoFromDay(d)] = log;
  }
  return state;
}

describe('DailySummaryService', () => {
  it('computes deterministic scores and falls back to aiFallback', async () => {
    const { service, planner, config } = makeSummaryService();
    const dateISO = isoFromDay(8);
    const state = withRecentCompletion(emptyAppState(), planner, 8);
    state.startDateISO = '2026-01-01';
    // Complete every required task of day 8.
    const plan = planner.buildPlan(state, dateISO, config);
    const log: Record<string, boolean> = {};
    for (const t of plan.tasks) log[t.entry.id] = true;
    state.taskLogs[dateISO] = log;

    const summary = await service.build(state, dateISO, config);
    expect(summary.aiFallback).toBe(true);
    expect(summary.productivityScore).toBe(100);
    expect(summary.thinkingScore).toBeGreaterThan(0);
    expect(summary.missedTaskIds).toHaveLength(0);
  });

  it('runDailyPipeline persists the summary and writes memory', async () => {
    const { service, planner, config } = makeSummaryService();
    const state = withRecentCompletion(emptyAppState(), planner, 8);
    state.startDateISO = '2026-01-01';
    const dateISO = isoFromDay(8);
    const plan = planner.buildPlan(state, dateISO, config);
    const log: Record<string, boolean> = {};
    for (const t of plan.tasks) log[t.entry.id] = true;
    state.taskLogs[dateISO] = log;

    const next = await service.runDailyPipeline(state, dateISO, config);
    expect(next.summaries).toHaveLength(1);
    expect(next.summaries[0].dateISO).toBe(dateISO);
    expect(next.lastSummaryDate).toBe(dateISO);
    expect(next.memory.entries.length).toBeGreaterThan(0);
    expect(next.memory.entries.some((e) => e.type === 'progression')).toBe(true);
  });

  it('dedupes summaries by date', async () => {
    const { service, planner, config } = makeSummaryService();
    const state = withRecentCompletion(emptyAppState(), planner, 8);
    state.startDateISO = '2026-01-01';
    const dateISO = isoFromDay(8);
    const first = await service.runDailyPipeline(state, dateISO, config);
    const second = await service.runDailyPipeline(first, dateISO, config);
    expect(second.summaries.filter((s) => s.dateISO === dateISO)).toHaveLength(1);
  });
});
