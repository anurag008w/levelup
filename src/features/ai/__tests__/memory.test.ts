import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { MemoryStore } from '../../../core/domain/memory';
import { MEMORY_BYTES_BUDGET } from '../../../core/domain/memory';
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

  it('honours the summarized flag and session tags on add', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, {
      type: 'conversation',
      content: 'Aim: IIT, weak in Physics.',
      source: 'ai',
      importance: 0.6,
      summarized: true,
      tags: ['chat', 'session-1'],
    });
    expect(state.memory.entries).toHaveLength(1);
    expect(state.memory.entries[0].summarized).toBe(true);
    expect(state.memory.entries[0].context.tags).toContain('session-1');
  });

  it('updates a specific entry by id (entries and summaries)', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'journal', content: 'old text', source: 'user' });
    state = memory.add(state, { type: 'observation', content: 'other', source: 'ai' });
    const target = state.memory.entries[0];
    state = memory.update(state, target.id, { content: 'new text', importance: 0.9 });
    const updated = state.memory.entries.find((e) => e.id === target.id);
    expect(updated?.content).toBe('new text');
    expect(updated?.importance).toBe(0.9);
    expect(state.memory.entries.find((e) => e.id !== target.id)?.content).toBe('other');
  });

  it('deletes a specific entry by id', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'journal', content: 'keep me', source: 'user' });
    state = memory.add(state, { type: 'observation', content: 'delete me', source: 'ai' });
    const target = state.memory.entries.find((e) => e.content === 'delete me')!;
    state = memory.remove(state, target.id);
    expect(state.memory.entries.some((e) => e.id === target.id)).toBe(false);
    expect(state.memory.entries).toHaveLength(1);
  });

  it('removes conversation entries by session tag only', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'conversation', content: 'old chat a', source: 'ai', summarized: true, tags: ['chat', 'session-1'] });
    state = memory.add(state, { type: 'conversation', content: 'old chat b', source: 'ai', summarized: true, tags: ['chat', 'session-1'] });
    state = memory.add(state, { type: 'conversation', content: 'keep me', source: 'ai', tags: ['chat', 'session-2'] });
    state = memory.add(state, { type: 'journal', content: 'keep note', source: 'user', tags: ['session-1'] });
    state = memory.removeConversationByTag(state, 'session-1');
    const contents = state.memory.entries.map((e) => e.content);
    expect(contents).not.toContain('old chat a');
    expect(contents).not.toContain('old chat b');
    expect(contents).toContain('keep me');
    expect(contents).toContain('keep note');
  });

  it('removes only the raw transcript archive for a session, keeping AI summaries', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'conversation', content: 'raw transcript abc', source: 'system', importance: 0.6, tags: ['chat', 'transcript', 'session:abc'] });
    state = memory.add(state, { type: 'conversation', content: 'AI condensed abc', source: 'ai', importance: 0.7, summarized: true, tags: ['chat', 'ai-summary', 'session:abc'] });
    state = memory.add(state, { type: 'conversation', content: 'raw transcript xyz', source: 'system', importance: 0.6, tags: ['chat', 'transcript', 'session:xyz'] });
    state = memory.removeTranscriptArchive(state, 'abc');
    const contents = state.memory.entries.map((e) => e.content);
    expect(contents).not.toContain('raw transcript abc');
    expect(contents).toContain('AI condensed abc');
    // Other sessions' archives are untouched.
    expect(contents).toContain('raw transcript xyz');
  });

  it('groups conversation summaries into one block per chat', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'conversation', content: 'Aim IIT Delhi', source: 'ai', summarized: true, tags: ['chat', 's1'], blockId: 'chat:s1', longTerm: true });
    state = memory.add(state, { type: 'conversation', content: 'Weak: Calculus', source: 'ai', summarized: true, tags: ['chat', 's1'], blockId: 'chat:s1' });
    state = memory.add(state, { type: 'conversation', content: 'Physics strong', source: 'ai', summarized: true, tags: ['chat', 's2'], blockId: 'chat:s2' });
    const blocks = memory.listBlocks(state);
    expect(blocks).toHaveLength(2);
    const s1 = blocks.find((b) => b.blockId === 'chat:s1');
    expect(s1?.entries).toHaveLength(2);
    expect(s1?.entries[0].longTerm).toBe(true);
  });

  it('curates goals, preferences and high-importance entries into long-term memory', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'goal', content: 'Target 200 marks', source: 'user', importance: 0.9 });
    state = memory.add(state, { type: 'preference', content: 'Prefers evening study', source: 'user', importance: 0.6 });
    state = memory.add(state, { type: 'journal', content: 'low value note', source: 'user', importance: 0.3 });
    state = memory.add(state, { type: 'observation', content: 'important observation', source: 'ai', importance: 0.85 });
    state = memory.curateLongTerm(state);
    const pinned = state.memory.entries.filter((e) => e.longTerm);
    const contents = pinned.map((e) => e.content);
    expect(contents).toContain('Target 200 marks');
    expect(contents).toContain('Prefers evening study');
    expect(contents).toContain('important observation');
    expect(contents).not.toContain('low value note');
  });

  it('pins and unpins specific entries via setLongTerm', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'journal', content: 'pinnable note', source: 'user', importance: 0.5 });
    const target = state.memory.entries[0];
    state = memory.setLongTerm(state, [target.id], true);
    expect(state.memory.entries[0].longTerm).toBe(true);
    state = memory.setLongTerm(state, [target.id], false);
    expect(state.memory.entries[0].longTerm).toBe(false);
  });

  it('never lets the serialized memory exceed the byte budget (quota safety)', () => {
    const memory = makeService();
    let state = emptyAppState();
    const big = 'x'.repeat(300_000);
    // 12 × 300KB transcripts >> 2.5MB budget — the budget prune must kick in.
    for (let i = 0; i < 12; i++) {
      state = memory.add(state, {
        type: 'conversation',
        content: big,
        source: 'system',
        tags: ['chat', 'transcript'],
        createdAt: `2026-02-${String(1 + i).padStart(2, '0')}`,
      });
    }
    const size = JSON.stringify(state.memory).length;
    expect(size).toBeLessThanOrEqual(MEMORY_BYTES_BUDGET);
    // Only as much as needed is dropped — newer/smaller entries survive.
    expect(state.memory.entries.length).toBeGreaterThan(0);
  });

  it('keeps long-term and AI-condensed entries during byte-budget pruning', () => {
    const memory = makeService();
    let state = emptyAppState();
    const big = 'z'.repeat(400_000);
    state = memory.add(state, { type: 'goal', content: 'IIT Delhi', source: 'user', importance: 0.9, longTerm: true });
    state = memory.add(state, { type: 'conversation', content: 'condensed', source: 'ai', summarized: true, importance: 0.6 });
    for (let i = 0; i < 10; i++) {
      state = memory.add(state, { type: 'conversation', content: big, source: 'system', tags: ['chat', 'transcript'] });
    }
    const contents = state.memory.entries.map((e) => e.content);
    expect(contents).toContain('IIT Delhi');
    expect(contents).toContain('condensed');
    expect(JSON.stringify(state.memory).length).toBeLessThanOrEqual(MEMORY_BYTES_BUDGET);
  });

  it('round-trips memory through the export/import backup format', () => {
    const memory = makeService();
    let state = emptyAppState();
    state = memory.add(state, { type: 'goal', content: 'IIT Delhi', source: 'user', importance: 0.9 });
    state = memory.add(state, { type: 'conversation', content: 'chat archive', source: 'system', importance: 0.6, tags: ['chat', 'session:abc'] });
    const json = memory.exportMemory(state);
    expect(json).toContain('ai-memory-backup');

    const restored = memory.importMemory(emptyAppState(), json);
    expect(restored.memory.entries).toHaveLength(2);
    expect(restored.memory.entries.find((e) => e.content === 'IIT Delhi')?.type).toBe('goal');
    expect(restored.memory.entries.find((e) => e.content === 'chat archive')?.context.tags).toContain('session:abc');
    // Import replaces only memory — the rest of the state is untouched.
    expect(restored.startDateISO).toBe(emptyAppState().startDateISO);
  });

  it('drops corrupt entries on import and throws on malformed JSON', () => {
    const memory = makeService();
    const state = memory.importMemory(
      emptyAppState(),
      JSON.stringify({ memory: { entries: [{ id: 1 }, { id: 'ok', type: 'goal', content: 'x', importance: 0.5, source: 'user', createdAt: '2026-07-01', context: { tags: [] } }], summaries: [], lastSummarizedAt: null } }),
    );
    expect(state.memory.entries).toHaveLength(1);
    expect(state.memory.entries[0].content).toBe('x');
    expect(() => memory.importMemory(emptyAppState(), 'not-json')).toThrow();
  });
});
