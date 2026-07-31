import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { MemoryStore } from '../../../core/domain/memory';
import { MemoryService, MEMORY_SUMMARIZE_THRESHOLD } from '../memory.service';
import type { Clock } from '../../../core/ports/clock';

class FixedClock implements Clock {
  private readonly nowISO: string;

  constructor(nowISO: string) {
    this.nowISO = nowISO;
  }

  now(): Date {
    return new Date(this.nowISO + 'T12:00:00');
  }
}

function makeService(nowISO = '2026-03-01') {
  return new MemoryService(new FixedClock(nowISO));
}

describe('MemoryService', () => {
  it('appends entries with importance clamps', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'journal', content: 'good day', source: 'user', importance: 1.5 });
    state = memory.add(state, { type: 'goal', content: 'target 200 marks', source: 'user', importance: -1 });
    expect(state.memory.entries).toHaveLength(2);
    expect(state.memory.entries[0].importance).toBe(1);
    expect(state.memory.entries[1].importance).toBe(0);
  });

  it('condenses old low-importance entries into rollups on summarize', () => {
    const memory = makeService();
    let state = emptyAppState();
    // 3 old low-importance entries (> 7 days old) + 1 fresh.
    for (const day of ['2026-02-20', '2026-02-21', '2026-02-22', '2026-02-28']) {
      state = memory.add(state, { type: 'journal', content: `entry ${day}`, source: 'user', importance: 0.3, createdAt: day });
    }
    const summarized = memory.summarize(state.memory);
    expect(summarized.summaries.length).toBeGreaterThan(0);
    expect(summarized.entries.every((e) => e.createdAt >= '2026-02-22')).toBe(true);
    expect(summarized.lastSummarizedAt).toBe('2026-03-01');
  });

  it('auto-summarizes once entries pass the threshold', () => {
    const memory = makeService();
    let state = emptyAppState();
    for (let i = 0; i < MEMORY_SUMMARIZE_THRESHOLD + 10; i++) {
      const day = `2026-02-${String(1 + (i % 28)).padStart(2, '0')}`;
      state = memory.add(state, { type: 'journal', content: `entry ${i}`, source: 'user', importance: 0.2, createdAt: day });
    }
    expect(state.memory.summaries.length).toBeGreaterThan(0);
    expect(state.memory.entries.length).toBeLessThanOrEqual(200);
  });

  it('returns relevant entries newest first', () => {
    const memory = makeService();
    let state = emptyAppState();
    for (const day of ['2026-02-20', '2026-02-27', '2026-02-28']) {
      state = memory.add(state, { type: 'observation', content: `obs ${day}`, source: 'ai', importance: 0.5, createdAt: day });
    }
    const relevant = memory.relevant(state, { types: ['observation'], max: 2 });
    expect(relevant).toHaveLength(2);
    expect(relevant[0].content).toBe('obs 2026-02-28');
  });

  it('preserves at least one recent entry per habit through pruning', () => {
    const memory = makeService();
    let state = emptyAppState();
    for (let i = 0; i < MEMORY_SUMMARIZE_THRESHOLD + 20; i++) {
      state = memory.add(state, {
        type: 'journal',
        content: `note ${i}`,
        source: 'user',
        importance: 0.1,
        habitId: i === 0 ? 'rare_habit' : undefined,
      });
    }
    // Rare_habit entry is old now; ensure the entry itself still has content
    // recorded somewhere (rollup or kept verbatim).
    const all = [...state.memory.entries, ...state.memory.summaries];
    const rare = all.find((e: MemoryStore['entries'][number]) => e.content.includes('note 0'));
    expect(rare).toBeDefined();
  });
});
