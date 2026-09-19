import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { DailySummary } from '../../../core/domain/summary';
import { mergeDaySummary, shouldRollupDay } from '../summary-scheduler';

function summary(dateISO: string, id = `s-${dateISO}`): DailySummary {
  return {
    id,
    dateISO,
    completedTaskIds: [],
    missedTaskIds: [],
    habitProgress: {},
    streak: 1,
    weakHabitIds: [],
    strongHabitIds: [],
    revisionCompletedIds: [],
    backlogStatus: { count: 0, cleared: 0 },
    journalInsights: [],
    aiObservations: [],
    thinkingScore: 50,
    productivityScore: 60,
    planForTomorrow: [],
    gapsDetected: 0,
    aiFallback: true,
    createdAt: new Date().toISOString(),
  };
}

describe('shouldRollupDay (M8)', () => {
  it('is false before the journey starts', () => {
    expect(shouldRollupDay(emptyAppState(), '2026-07-15')).toBe(false);
  });

  it('is true on the first day after the journey starts', () => {
    const s = { ...emptyAppState(), startDateISO: '2026-07-01' };
    expect(shouldRollupDay(s, '2026-07-15')).toBe(true);
  });

  it('is true on the journey start date itself', () => {
    const s = { ...emptyAppState(), startDateISO: '2026-07-15' };
    expect(shouldRollupDay(s, '2026-07-15')).toBe(true);
  });

  it('is false once the day already has a summary (idempotent per date)', () => {
    const s = { ...emptyAppState(), startDateISO: '2026-07-01', lastSummaryDate: '2026-07-15' };
    expect(shouldRollupDay(s, '2026-07-15')).toBe(false);
    // A NEW day is eligible again.
    expect(shouldRollupDay(s, '2026-07-16')).toBe(true);
  });
});

describe('mergeDaySummary (M8)', () => {
  it('keeps the latest state and only takes the summary fields + memory additions from the pipeline', () => {
    const latest = { ...emptyAppState(), startDateISO: '2026-07-01', bonusDaysUsed: 4 };
    const next = {
      ...emptyAppState(),
      startDateISO: '2026-07-01',
      bonusDaysUsed: 0, // stale snapshot — must NOT clobber the live value
      summaries: [summary('2026-07-15', 'fresh')],
      lastSummaryDate: '2026-07-15',
      memory: {
        entries: [{ id: 'm1', type: 'goal' as const, content: 'IIT', importance: 0.9, source: 'user' as const, createdAt: '2026-07-01', summarized: false, context: { tags: [] } }],
        summaries: [],
        lastSummarizedAt: null,
      },
    };
    const merged = mergeDaySummary(latest, next, '2026-07-15');
    expect(merged.bonusDaysUsed).toBe(4); // live edit preserved
    expect(merged.summaries).toHaveLength(1);
    expect(merged.summaries[0].id).toBe('fresh');
    expect(merged.lastSummaryDate).toBe('2026-07-15');
    expect(merged.memory.entries).toHaveLength(1);
  });

  it('preserves memory written after the pipeline snapshot while importing pipeline-only additions', () => {
    const latest = {
      ...emptyAppState(),
      memory: {
        entries: [{ id: 'concurrent', type: 'goal' as const, content: 'latest edit', importance: 0.9, source: 'user' as const, createdAt: '2026-07-16', summarized: false, context: { tags: [] } }],
        summaries: [],
        lastSummarizedAt: '2026-07-16T10:00:00.000Z',
      },
    };
    const next = {
      ...emptyAppState(),
      memory: {
        entries: [
          { id: 'concurrent', type: 'goal' as const, content: 'stale snapshot', importance: 0.5, source: 'user' as const, createdAt: '2026-07-15', summarized: false, context: { tags: [] } },
          { id: 'pipeline-added', type: 'observation' as const, content: 'summary insight', importance: 0.7, source: 'ai' as const, createdAt: '2026-07-16', summarized: true, context: { tags: [] } },
        ],
        summaries: [{ id: 'pipeline-summary', type: 'summary' as const, content: 'condensed', importance: 0.8, source: 'ai' as const, createdAt: '2026-07-16', summarized: true, context: { tags: [] } }],
        lastSummarizedAt: '2026-07-16T11:00:00.000Z',
      },
    };

    const merged = mergeDaySummary(latest, next, '2026-07-16');
    expect(merged.memory.entries.map((entry) => entry.id)).toEqual(['concurrent', 'pipeline-added']);
    expect(merged.memory.entries[0].content).toBe('latest edit');
    expect(merged.memory.summaries.map((entry) => entry.id)).toEqual(['pipeline-summary']);
    expect(merged.memory.lastSummarizedAt).toBe('2026-07-16T11:00:00.000Z');
  });

  it('does not move the summary timestamp backwards when the pipeline snapshot is stale', () => {
    const latest = {
      ...emptyAppState(),
      memory: { ...emptyAppState().memory, lastSummarizedAt: '2026-07-16T12:00:00.000Z' },
    };
    const next = {
      ...emptyAppState(),
      memory: { ...emptyAppState().memory, lastSummarizedAt: '2026-07-16T11:00:00.000Z' },
    };
    const merged = mergeDaySummary(latest, next, '2026-07-16');
    expect(merged.memory.lastSummarizedAt).toBe('2026-07-16T12:00:00.000Z');
  });

  it('replaces an existing summary for the same date instead of duplicating', () => {
    const latest = {
      ...emptyAppState(),
      summaries: [summary('2026-07-15', 'old')],
      lastSummaryDate: '2026-07-15',
    };
    const next = {
      ...emptyAppState(),
      summaries: [summary('2026-07-15', 'new')],
      lastSummaryDate: '2026-07-15',
    };
    const merged = mergeDaySummary(latest, next, '2026-07-15');
    expect(merged.summaries).toHaveLength(1);
    expect(merged.summaries[0].id).toBe('new');
  });

  it('keeps summaries for other dates untouched', () => {
    const latest = { ...emptyAppState(), summaries: [summary('2026-07-14', 'prev')] };
    const next = { ...emptyAppState(), summaries: [summary('2026-07-15', 'fresh')], lastSummaryDate: '2026-07-15' };
    const merged = mergeDaySummary(latest, next, '2026-07-15');
    expect(merged.summaries.map((s) => s.id).sort()).toEqual(['fresh', 'prev']);
  });
});
