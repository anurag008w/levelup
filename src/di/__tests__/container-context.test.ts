import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../core/domain/state';
import { container } from '../container';
import { buildRecentProgress, buildJourneyOverview } from '../../features/chat/context-overview';
import type { DailySummary } from '../../core/domain/summary';

const TODAY = '2026-01-08';
const START = '2026-01-01';

function summary(partial: Partial<DailySummary>): DailySummary {
  return {
    id: partial.dateISO ?? '',
    dateISO: partial.dateISO ?? '',
    completedTaskIds: [],
    missedTaskIds: [],
    habitProgress: {},
    streak: 0,
    weakHabitIds: [],
    strongHabitIds: [],
    revisionCompletedIds: [],
    backlogStatus: { count: 0, cleared: 0 },
    journalInsights: [],
    aiObservations: [],
    thinkingScore: 0,
    productivityScore: 0,
    planForTomorrow: [],
    gapsDetected: 0,
    aiFallback: false,
    createdAt: partial.createdAt ?? partial.dateISO ?? '',
    ...partial,
  };
}

function stateWith(opts: { days?: Record<string, string[]>; summaries?: DailySummary[] } = {}): ReturnType<typeof emptyAppState> {
  const s = emptyAppState();
  s.startDateISO = START;
  const days = opts.days ?? { '2026-01-01': ['t1'] };
  for (const [date, ids] of Object.entries(days)) {
    s.taskLogs[date] = {};
    for (const id of ids) s.taskLogs[date][id] = true;
  }
  s.summaries = opts.summaries ?? [];
  return s;
}

describe('buildRecentProgress', () => {
  it('returns [] before the journey starts', () => {
    const s = emptyAppState();
    expect(buildRecentProgress(s, TODAY, container.planner)).toEqual([]);
  });

  it('renders one line per journey day so far, up to the last 14 days (inclusive)', () => {
    const rows = buildRecentProgress(stateWith(), TODAY, container.planner);
    expect(rows).toHaveLength(8); // day 8 of 8
    expect(rows[0]).toContain('Day 1');
    expect(rows[7]).toContain('Day 8');
    expect(rows[0]).toMatch(/Day 1: \d+\/\d+ done \(\d+%\)/);
  });

  it('caps at 14 rows once the journey passes day 14', () => {
    const rows = buildRecentProgress(stateWith(), '2026-01-25', container.planner);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toContain('Day 12');
    expect(rows[13]).toContain('Day 25');
  });

  it('skips days before day 1 when the journey is short', () => {
    const rows = buildRecentProgress(stateWith(), '2026-01-03', container.planner);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Day 1');
  });
});

describe('buildJourneyOverview', () => {
  it('reports mission not started before startDateISO', () => {
    expect(buildJourneyOverview(emptyAppState(), TODAY)).toBe('mission not started');
  });

  it('computes XP, level, consistency, streak and active days', () => {
    const s = stateWith({
      days: {
        '2026-01-01': ['t1', 't2'],
        '2026-01-02': ['t3'],
        '2026-01-07': ['t4'],
      },
    });
    const out = buildJourneyOverview(s, TODAY);
    expect(out).toContain('Total XP 40'); // 4 tasks × 10
    expect(out).toContain('level 1, 40/250');
    expect(out).toContain('consistency 38% over 8 days (3 active)'); // 3/8
    expect(out).toContain('overall streak 0'); // today inactive → current streak breaks at 0
  });

  it('includes habit tiers and achievements once thresholds are hit', () => {
    const s = stateWith({ days: { '2026-01-01': ['t1'] } });
    const out = buildJourneyOverview(s, TODAY);
    expect(out).toContain('best habit');
    expect(out).toContain('weakest habit');
    // dayNumber 8 → week-1 achievement; cleared levels 0 → no first-level badge
    expect(out).toContain('Week 1 done');
    expect(out).not.toContain('first level cleared');
  });

  it('appends the latest day snapshot when summaries exist', () => {
    const s = stateWith({
      summaries: [
        summary({ dateISO: '2026-01-06', productivityScore: 72, thinkingScore: 55, aiObservations: ['deep focus on mechanics'] }),
        summary({ dateISO: '2026-01-05', productivityScore: 40, thinkingScore: 30, aiObservations: [] }),
      ],
    });
    const out = buildJourneyOverview(s, TODAY);
    expect(out).toContain('latest day snapshot 2026-01-06: productivity 72%, thinking 55%');
    expect(out).toContain('deep focus on mechanics');
  });
});
