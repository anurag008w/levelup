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

describe('MemoryToolsService', () => {
  function setup() {
    const memory = new MemoryService(new FixedClock());
    let state = emptyAppState();
    state = memory.add(state, { type: 'goal', content: 'Target JEE Advanced 2026', source: 'user', importance: 0.9 });
    state = memory.add(state, { type: 'preference', content: 'Prefers Hinglish explanations', source: 'user', importance: 0.7 });
    const store = makeStore(state);
    return { tools: new MemoryToolsService(store, memory), store, memory };
  }

  it('detects memory queries', () => {
    const { tools } = setup();
    expect(tools.isMemoryQuery('tumhe kya yaad hai?')).toBe(true);
    expect(tools.isMemoryQuery('memory me kya hai')).toBe(true);
    expect(tools.isMemoryQuery('us memory entry ko delete karo')).toBe(true);
    expect(tools.isMemoryQuery('aaj ka plan kya hai')).toBe(false);
  });

  it('parses single, batch and array tool replies', () => {
    const { tools } = setup();
    expect(tools.parseTools('{"action":"readMemory"}')).toHaveLength(1);
    expect(tools.parseTools('{"actions":[{"action":"readMemory"},{"action":"readMemory"}]}')).toHaveLength(2);
    expect(tools.parseTools('[{"action":"readMemory"}]')).toHaveLength(1);
    expect(tools.parseTools('sure!')).toHaveLength(0);
  });

  it('reads current memory', async () => {
    const { tools } = setup();
    const result = await tools.runMany([{ action: 'readMemory' }]);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Target JEE Advanced 2026');
    expect(result.summary).toContain('id:');
  });

  it('edits an entry by id', async () => {
    const { tools, store } = setup();
    const id = store.get().memory.entries[0].id;
    const result = await tools.runMany([{ action: 'editMemory', id, content: 'Target JEE Advanced + Delhi NIT' }]);
    expect(result.ok).toBe(true);
    expect(store.get().memory.entries[0].content).toBe('Target JEE Advanced + Delhi NIT');
  });

  it('requires explicit confirmation before deleting', async () => {
    const { tools, store } = setup();
    const id = store.get().memory.entries[0].id;
    const preview = await tools.runMany([{ action: 'deleteMemory', id }]);
    expect(preview.requiresConfirmation).toBe(true);
    // Entry is untouched after the preview.
    expect(store.get().memory.entries.some((e) => e.id === id)).toBe(true);

    const applied = await tools.runMany([{ action: 'deleteMemory', id, confirmed: true }]);
    expect(applied.requiresConfirmation).toBeFalsy();
    expect(store.get().memory.entries.some((e) => e.id === id)).toBe(false);
  });

  it('pins and unpins entries as long-term memory', async () => {
    const { tools, store } = setup();
    const id = store.get().memory.entries[0].id;
    await tools.runMany([{ action: 'pinMemory', id }]);
    expect(store.get().memory.entries.find((e) => e.id === id)?.longTerm).toBe(true);
    await tools.runMany([{ action: 'unpinMemory', id }]);
    expect(store.get().memory.entries.find((e) => e.id === id)?.longTerm).toBe(false);
  });
});
