import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { AppState } from '../../../core/domain/state';
import type { StateStore } from '../../../core/ports/repositories';
import type { Clock } from '../../../core/ports/clock';
import { MemoryService } from '../../ai/memory.service';
import { MemoryToolsService } from '../memory-tools.service';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-03-01T12:00:00');
  }
}

function makeStore(state: AppState): StateStore {
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

function setup() {
  const memory = new MemoryService(new FixedClock());
  let state = emptyAppState();
  state = memory.add(state, { type: 'goal', content: 'Target JEE Advanced 2026', source: 'user', importance: 0.9 });
  state = memory.add(state, { type: 'preference', content: 'Prefers Hinglish explanations', source: 'user', importance: 0.7 });
  // A condensed summary entry so every tool can be proven on summaries too.
  state = {
    ...state,
    memory: {
      ...state.memory,
      summaries: [
        {
          id: 'sum-1',
          type: 'summary',
          createdAt: '2026-03-01',
          content: 'Week of 2026-02-23: thermodynamics revision done',
          importance: 0.5,
          summarized: true,
          source: 'system',
          context: { tags: ['rollup'] },
        },
      ],
    },
  };
  const store = makeStore(state);
  return { tools: new MemoryToolsService(store, memory), store, memory };
}

describe('MemoryToolsService', () => {
  describe('isMemoryQuery', () => {
    it('detects memory queries across Hinglish variants', () => {
      const { tools } = setup();
      expect(tools.isMemoryQuery('tumhe kya yaad hai?')).toBe(true);
      expect(tools.isMemoryQuery('memory me kya hai')).toBe(true);
      expect(tools.isMemoryQuery('us memory entry ko delete karo')).toBe(true);
      expect(tools.isMemoryQuery('yaad rakhna meri physics weak hai')).toBe(true);
      expect(tools.isMemoryQuery('yaad rakho IIT Delhi chahiye')).toBe(true);
      expect(tools.isMemoryQuery('mat bhoolna kal mock test hai')).toBe(true);
      expect(tools.isMemoryQuery('ye bhool mat jaana')).toBe(true);
      expect(tools.isMemoryQuery('note kar le ye formula')).toBe(true);
      expect(tools.isMemoryQuery('long term memory me daal do')).toBe(true);
      expect(tools.isMemoryQuery('edit memory entry wala')).toBe(true);
      expect(tools.isMemoryQuery('pehle bola tha merko')).toBe(true);
    });

    it('ignores ordinary study questions', () => {
      const { tools } = setup();
      expect(tools.isMemoryQuery('aaj ka plan kya hai')).toBe(false);
      expect(tools.isMemoryQuery('integration kaise solve kare')).toBe(false);
      expect(tools.isMemoryQuery('physics me kya padhu')).toBe(false);
      expect(tools.isMemoryQuery('hello')).toBe(false);
    });
  });

  describe('parseTools', () => {
    it('parses single, batch and array tool replies', () => {
      const { tools } = setup();
      expect(tools.parseTools('{"action":"readMemory"}')).toEqual([{ action: 'readMemory' }]);
      expect(tools.parseTools('{"actions":[{"action":"readMemory"},{"action":"readMemory"}]}')).toHaveLength(2);
      expect(tools.parseTools('[{"action":"readMemory"}]')).toEqual([{ action: 'readMemory' }]);
      expect(tools.parseTools('sure!')).toHaveLength(0);
      expect(tools.parseTools('')).toHaveLength(0);
    });

    it('extracts JSON from prose and markdown fences', () => {
      const { tools } = setup();
      expect(tools.parseTools('ok so {"action":"readMemory"} done')).toEqual([{ action: 'readMemory' }]);
      expect(tools.parseTools('```json\n{"action":"readMemory"}\n```')).toEqual([{ action: 'readMemory' }]);
    });

    it('caps oversized batches and arrays at 20 actions', () => {
      const { tools } = setup();
      const one = { action: 'readMemory' } as const;
      expect(tools.parseTools(JSON.stringify({ actions: Array(30).fill(one) }))).toHaveLength(20);
      expect(tools.parseTools(JSON.stringify(Array(25).fill(one)))).toHaveLength(20);
    });

    it('drops invalid items but keeps valid ones', () => {
      const { tools } = setup();
      const mixed = [
        { action: 'readMemory' },
        { action: 'deleteMemory', id: '' }, // empty id — invalid
        { action: 'explode' },
        { action: 'addMemory', content: 'phy weak' },
      ];
      const parsed = tools.parseTools(JSON.stringify(mixed));
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ action: 'readMemory' });
      expect(parsed[1]).toEqual({ action: 'addMemory', content: 'phy weak' });
    });

    it('rejects unknown actions and empty/oversized addMemory content', () => {
      const { tools } = setup();
      expect(tools.parseTools('{"action":"forgetEverything"}')).toHaveLength(0);
      expect(tools.parseTools('{"action":"addMemory","content":""}')).toHaveLength(0);
      expect(tools.parseTools(`{"action":"addMemory","content":"${'x'.repeat(501)}"}`)).toHaveLength(0);
      expect(tools.parseTools('{"action":"addMemory","content":"valid","importance":5}')).toHaveLength(0); // importance > 1
    });

    it('parses addMemory with type and importance', () => {
      const { tools } = setup();
      expect(tools.parseTools('{"action":"addMemory","content":"IIT Delhi","type":"goal","importance":0.9}')).toEqual([
        { action: 'addMemory', content: 'IIT Delhi', type: 'goal', importance: 0.9 },
      ]);
    });
  });

  describe('readMemory', () => {
    it('reads entries and summaries', async () => {
      const { tools } = setup();
      const result = await tools.runMany([{ action: 'readMemory' }]);
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('Target JEE Advanced 2026');
      expect(result.summary).toContain('thermodynamics revision done');
      expect(result.summary).toContain('id:');
    });

    it('reports an empty memory honestly', async () => {
      const memory = new MemoryService(new FixedClock());
      const store = makeStore(emptyAppState());
      const tools = new MemoryToolsService(store, memory);
      const result = await tools.runMany([{ action: 'readMemory' }]);
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('khaali');
    });
  });

  describe('addMemory', () => {
    it('saves a fact with safe defaults (observation, user, 0.5)', async () => {
      const { tools, store } = setup();
      const result = await tools.runMany([{ action: 'addMemory', content: 'Organic chemistry weak hai' }]);
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('Organic chemistry weak hai');

      const added = store.get().memory.entries.find((e) => e.content === 'Organic chemistry weak hai');
      expect(added).toBeDefined();
      expect(added?.type).toBe('observation');
      expect(added?.source).toBe('user');
      expect(added?.importance).toBe(0.5);
      expect(added?.context.tags).toEqual([]);
    });

    it('honours an explicit type and importance', async () => {
      const { tools, store } = setup();
      await tools.runMany([{ action: 'addMemory', content: 'IIT Delhi', type: 'goal', importance: 0.9 }]);
      const added = store.get().memory.entries.find((e) => e.content === 'IIT Delhi');
      expect(added?.type).toBe('goal');
      expect(added?.importance).toBe(0.9);
    });

    it('makes the new fact visible to a follow-up readMemory', async () => {
      const { tools, store } = setup();
      await tools.runMany([{ action: 'addMemory', content: 'Sunday ko mock test' }]);
      const read = await tools.runMany([{ action: 'readMemory' }]);
      expect(read.summary).toContain('Sunday ko mock test');
      expect(store.get().memory.entries.some((e) => e.content === 'Sunday ko mock test')).toBe(true);
    });
  });

  describe('editMemory', () => {
    it('edits a user entry by id', async () => {
      const { tools, store } = setup();
      const id = store.get().memory.entries[0].id;
      const result = await tools.runMany([{ action: 'editMemory', id, content: 'Target JEE Advanced + Delhi NIT' }]);
      expect(result.ok).toBe(true);
      expect(store.get().memory.entries[0].content).toBe('Target JEE Advanced + Delhi NIT');
    });

    it('edits a condensed summary by id', async () => {
      const { tools, store } = setup();
      const result = await tools.runMany([{ action: 'editMemory', id: 'sum-1', content: 'Week: thermo + electrostatics done' }]);
      expect(result.ok).toBe(true);
      expect(store.get().memory.summaries.find((e) => e.id === 'sum-1')?.content).toBe('Week: thermo + electrostatics done');
    });

    it('reports a missing id as failure', async () => {
      const { tools, store } = setup();
      const before = store.get();
      const result = await tools.runMany([{ action: 'editMemory', id: 'nope', content: 'x' }]);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('not found');
      expect(store.get()).toBe(before);
    });
  });

  describe('deleteMemory', () => {
    it('requires explicit confirmation and leaves the entry untouched on preview', async () => {
      const { tools, store } = setup();
      const id = store.get().memory.entries[0].id;
      const preview = await tools.runMany([{ action: 'deleteMemory', id }]);
      expect(preview.requiresConfirmation).toBe(true);
      expect(preview.ok).toBe(false);
      expect(store.get().memory.entries.some((e) => e.id === id)).toBe(true);
    });

    it('deletes an entry once confirmed', async () => {
      const { tools, store } = setup();
      const id = store.get().memory.entries[0].id;
      const applied = await tools.runMany([{ action: 'deleteMemory', id, confirmed: true }]);
      expect(applied.requiresConfirmation).toBeFalsy();
      expect(applied.ok).toBe(true);
      expect(store.get().memory.entries.some((e) => e.id === id)).toBe(false);
    });

    it('deletes a condensed summary once confirmed', async () => {
      const { tools, store } = setup();
      const applied = await tools.runMany([{ action: 'deleteMemory', id: 'sum-1', confirmed: true }]);
      expect(applied.ok).toBe(true);
      expect(store.get().memory.summaries.some((e) => e.id === 'sum-1')).toBe(false);
    });

    it('reports a missing id as failure', async () => {
      const { tools } = setup();
      const result = await tools.runMany([{ action: 'deleteMemory', id: 'ghost', confirmed: true }]);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('not found');
    });
  });

  describe('pinMemory / unpinMemory', () => {
    it('pins and unpins a user entry', async () => {
      const { tools, store } = setup();
      const id = store.get().memory.entries[0].id;
      await tools.runMany([{ action: 'pinMemory', id }]);
      expect(store.get().memory.entries.find((e) => e.id === id)?.longTerm).toBe(true);
      await tools.runMany([{ action: 'unpinMemory', id }]);
      expect(store.get().memory.entries.find((e) => e.id === id)?.longTerm).toBe(false);
    });

    it('pins and unpins a condensed summary', async () => {
      const { tools, store } = setup();
      await tools.runMany([{ action: 'pinMemory', id: 'sum-1' }]);
      expect(store.get().memory.summaries.find((e) => e.id === 'sum-1')?.longTerm).toBe(true);
      await tools.runMany([{ action: 'unpinMemory', id: 'sum-1' }]);
      expect(store.get().memory.summaries.find((e) => e.id === 'sum-1')?.longTerm).toBe(false);
    });

    it('reports a missing id as failure', async () => {
      const { tools } = setup();
      expect((await tools.runMany([{ action: 'pinMemory', id: 'ghost' }])).ok).toBe(false);
      expect((await tools.runMany([{ action: 'unpinMemory', id: 'ghost' }])).ok).toBe(false);
    });
  });

  describe('runMany batching', () => {
    it('returns a failure for an empty action list', async () => {
      const { tools } = setup();
      const result = await tools.runMany([]);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('Koi memory action nahi mila');
    });

    it('returns ok:false when EVERY action fails (no false success)', async () => {
      const { tools } = setup();
      const result = await tools.runMany([
        { action: 'editMemory', id: 'ghost', content: 'x' },
        { action: 'deleteMemory', id: 'ghost', confirmed: true },
        { action: 'pinMemory', id: 'ghost' },
      ]);
      expect(result.ok).toBe(false);
      expect(result.requiresConfirmation).toBeFalsy();
    });

    it('threads state in order so later actions see earlier mutations', async () => {
      const { tools, store } = setup();
      const id = store.get().memory.entries[0].id;
      const result = await tools.runMany([
        { action: 'editMemory', id, content: 'Updated content 42' },
        { action: 'readMemory' },
      ]);
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('Updated content 42');
    });

    it('applies non-destructive actions while flagging a destructive preview', async () => {
      const { tools, store } = setup();
      const id = store.get().memory.entries[0].id;
      const result = await tools.runMany([
        { action: 'editMemory', id, content: 'kept' },
        { action: 'deleteMemory', id },
      ]);
      expect(result.requiresConfirmation).toBe(true);
      expect(store.get().memory.entries.find((e) => e.id === id)?.content).toBe('kept');
      expect(store.get().memory.entries.some((e) => e.id === id)).toBe(true); // delete still previewed
    });

    it('adds many facts without ever exceeding the memory byte budget', async () => {
      const { tools, store } = setup();
      const actions = Array.from({ length: 20 }, (_, i) => ({
        action: 'addMemory' as const,
        content: `Memory fact number ${i} — test`,
      }));
      const result = await tools.runMany(actions);
      expect(result.ok).toBe(true);
      expect(store.get().memory.entries.filter((e) => e.content.startsWith('Memory fact number'))).toHaveLength(20);
      expect(JSON.stringify(store.get().memory).length).toBeLessThan(100_000);
    });

    it('searches memory by keyword and filters by type', async () => {
      const { tools } = setup();
      const res = await tools.runMany([
        { action: 'searchMemory', query: 'Advanced' },
      ]);
      expect(res.ok).toBe(true);
      expect(res.summary).toContain('Target JEE Advanced 2026');

      const resType = await tools.runMany([
        { action: 'searchMemory', type: 'preference' },
      ]);
      expect(resType.ok).toBe(true);
      expect(resType.summary).toContain('Prefers Hinglish explanations');

      const emptyRes = await tools.runMany([
        { action: 'searchMemory', query: 'nonexistent-concept-xyz' },
      ]);
      expect(emptyRes.ok).toBe(true);
      expect(emptyRes.summary).toContain('koi saved memory nahi mili');
    });
  });
});
