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
  it('keeps the latest state and only takes the summary fields + memory from the pipeline', () => {
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
