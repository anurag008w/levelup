import { afterEach, describe, it, expect, vi } from 'vitest';
import { emptyAppState } from '../../core/domain/state';
import type { AppState } from '../../core/domain/state';
import type { KeyValueRepository } from '../../core/ports/repositories';
import {
  LocalStateRepository,
  normalizeState,
  CachedStateStore,
  hasV2Shape,
  STATE_KEY,
  STATE_KEY_V1,
} from './state-repository';
import { migrateV1toV2 } from './migration';

describe('normalizeState memory validation', () => {
  it('drops corrupt memory entries and keeps valid ones', () => {
    const raw = {
      ...emptyAppState(),
      memory: {
        entries: [
          { id: 'ok', type: 'goal', content: 'IIT Delhi', importance: 0.9, source: 'user', createdAt: '2026-07-01', context: { tags: [] } },
          { id: 1, type: 'journal' }, // corrupt — no content/createdAt/context
          'garbage',
          null,
          { id: 'no-tags', type: 'observation', content: 'x', importance: 0.5, source: 'ai', createdAt: '2026-07-01', context: { tags: 'oops' } },
        ],
        summaries: 'not-an-array',
        lastSummarizedAt: '2026-07-02',
      },
    };
    const state = normalizeState(raw);
    expect(state.memory.entries).toHaveLength(1);
    expect(state.memory.entries[0].content).toBe('IIT Delhi');
    expect(state.memory.summaries).toEqual([]);
    expect(state.memory.lastSummarizedAt).toBe('2026-07-02');
  });

  it('recovers a fully corrupt memory block to an empty store', () => {
    const raw = { ...emptyAppState(), memory: 42 };
    const state = normalizeState(raw);
    expect(state.memory.entries).toEqual([]);
    expect(state.memory.summaries).toEqual([]);
    expect(state.memory.lastSummarizedAt).toBeNull();
  });

  it('caps memory arrays during normalization', () => {
    const entries = [];
    for (let i = 0; i < 250; i++) {
      entries.push({ id: `e${i}`, type: 'journal', content: `note ${i}`, importance: 0.5, source: 'user', createdAt: '2026-07-01', context: { tags: [] } });
    }
    const summaries = [];
    for (let i = 0; i < 80; i++) {
      summaries.push({ id: `s${i}`, type: 'summary', content: `rollup ${i}`, importance: 0.5, source: 'system', createdAt: '2026-07-01', context: { tags: ['rollup'] } });
    }
    const state = normalizeState({ ...emptyAppState(), memory: { entries, summaries, lastSummarizedAt: null } });
    expect(state.memory.entries).toHaveLength(200);
    expect(state.memory.summaries).toHaveLength(50);
  });
});

describe('normalizeState timeZone', () => {
  it('keeps a valid IANA timezone string', () => {
    const state = normalizeState({ ...emptyAppState(), timeZone: 'Asia/Kolkata' });
    expect(state.timeZone).toBe('Asia/Kolkata');
  });

  it('falls back to null for missing, empty or malformed values', () => {
    expect(normalizeState(emptyAppState()).timeZone).toBeNull();
    expect(normalizeState({ ...emptyAppState(), timeZone: '' }).timeZone).toBeNull();
    expect(normalizeState({ ...emptyAppState(), timeZone: 42 }).timeZone).toBeNull();
  });
});

describe('normalizeState field defaults', () => {
  it('keeps valid v2 fields and falls back per-field for garbage', () => {
    const state = normalizeState({
      startDateISO: 42,
      bonusDaysUsed: 'x',
      taskLogs: 'nope',
      weeklyReviews: 'nope',
      clearedLevels: 7,
      studyTimeMinutes: -5,
      planCache: 'nope',
      lastSummaryDate: 1,
    });
    expect(state.startDateISO).toBeNull();
    expect(state.bonusDaysUsed).toBe(0);
    expect(state.taskLogs).toEqual({});
    expect(state.weeklyReviews).toEqual([]);
    expect(state.clearedLevels).toEqual([]);
    expect(state.studyTimeMinutes).toBe(360);
    expect(state.planCache).toEqual({});
    expect(state.lastSummaryDate).toBeNull();
  });

  it('clamps invalid study time to the default but keeps valid values', () => {
    expect(normalizeState({ ...emptyAppState(), studyTimeMinutes: 0 }).studyTimeMinutes).toBe(360);
    expect(normalizeState({ ...emptyAppState(), studyTimeMinutes: 120 }).studyTimeMinutes).toBe(120);
  });

  it('merges postJourney and userProfile onto their defaults', () => {
    const state = normalizeState({
      postJourney: { journeyComplete: true, extensionDays: 7 },
      userProfile: { name: 'Anurag' },
    });
    expect(state.postJourney.journeyComplete).toBe(true);
    expect(state.postJourney.extensionDays).toBe(7);
    expect(state.postJourney.customPhases).toEqual([]);
    expect(state.userProfile.name).toBe('Anurag');
    expect(state.userProfile.classLevel).toBe('');
  });

  it('keeps aiSettings only when providers is a record, else resets', () => {
    const good = normalizeState({
      aiSettings: { providers: { p: { id: 'p' } }, aiEnabled: false },
    });
    expect(good.aiSettings.aiEnabled).toBe(false);
    expect(good.aiSettings.providers.p).toBeDefined();
    const bad = normalizeState({ aiSettings: { providers: 'nope' } });
    expect(bad.aiSettings.providers).toEqual({});
    expect(bad.aiSettings.aiEnabled).toBe(true);
  });

  it('validates aiActionHistory shape', () => {
    const state = normalizeState({
      aiActionHistory: { versions: [{ id: 'v1' }], undone: [1] },
    });
    expect(state.aiActionHistory.versions).toEqual([{ id: 'v1' }]);
    expect(state.aiActionHistory.undone).toEqual([1]);
    expect(normalizeState({ aiActionHistory: 42 }).aiActionHistory.versions).toEqual([]);
  });
});

describe('hasV2Shape', () => {
  it('recognizes complete v2 payloads only', () => {
    expect(hasV2Shape(emptyAppState())).toBe(true);
    expect(hasV2Shape({ schemaVersion: 2 })).toBe(false);
    expect(hasV2Shape(null)).toBe(false);
    expect(hasV2Shape('x')).toBe(false);
  });
});

function memoryStore(): KeyValueRepository & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe('LocalStateRepository', () => {
  it('returns a fresh state when nothing is stored', () => {
    const repo = new LocalStateRepository(memoryStore());
    expect(repo.load()).toEqual(emptyAppState());
  });

  it('round-trips a save through load', () => {
    const store = memoryStore();
    const repo = new LocalStateRepository(store);
    const state = { ...emptyAppState(), startDateISO: '2026-01-01', timeZone: 'Asia/Kolkata' };
    repo.save(state);
    expect(repo.load().startDateISO).toBe('2026-01-01');
    expect(repo.load().timeZone).toBe('Asia/Kolkata');
  });

  it('recovers to fresh state on corrupt v2 (falls through to v1)', () => {
    const store = memoryStore();
    store.setItem(STATE_KEY, '{broken json');
    const repo = new LocalStateRepository(store);
    expect(repo.load()).toEqual(emptyAppState());
  });

  it('migrates v1 state and persists the v2 result', () => {
    const store = memoryStore();
    const v1 = migrateV1toV2({ ...emptyAppState(), startDateISO: '2026-02-02', taskLogs: { x: { a: true } } });
    store.setItem(STATE_KEY_V1, JSON.stringify(v1));
    const repo = new LocalStateRepository(store);
    const loaded = repo.load();
    expect(loaded.startDateISO).toBe('2026-02-02');
    expect(loaded.taskLogs.x).toEqual({ a: true });
    // The v2 key was written during migration.
    expect(store.data.get(STATE_KEY)).toContain('2026-02-02');
  });

  it('clear writes an empty state', () => {
    const store = memoryStore();
    const repo = new LocalStateRepository(store);
    repo.save({ ...emptyAppState(), startDateISO: '2026-01-01' });
    repo.clear();
    expect(repo.load().startDateISO).toBeNull();
  });
});

describe('CachedStateStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads once from the repository and caches', () => {
    const store = memoryStore();
    const repo = new LocalStateRepository(store);
    repo.save({ ...emptyAppState(), startDateISO: '2026-01-01' });
    const cached = new CachedStateStore(repo);
    expect(cached.get().startDateISO).toBe('2026-01-01');
    // Repository changes after first get are not seen by the cache.
    repo.save({ ...emptyAppState(), startDateISO: '2026-02-02' });
    expect(cached.get().startDateISO).toBe('2026-01-01');
    // save updates the cache immediately.
    cached.save({ ...emptyAppState(), startDateISO: '2026-03-03' });
    expect(cached.get().startDateISO).toBe('2026-03-03');
  });

  it('trailing-debounces repository writes and flushes on demand', () => {
    vi.useFakeTimers();
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    const cached = new CachedStateStore(repo, 400);
    // Cache is always fresh even though the repo write is deferred.
    cached.save({ ...emptyAppState(), startDateISO: '2026-04-04' });
    expect(cached.get().startDateISO).toBe('2026-04-04');
    expect(repo.load().startDateISO).toBeNull();
    // Trailing: rapid saves collapse into ONE write with the LATEST state.
    vi.advanceTimersByTime(100);
    cached.save({ ...emptyAppState(), startDateISO: '2026-05-05' });
    vi.advanceTimersByTime(300);
    expect(repo.load().startDateISO).toBeNull(); // still inside the window
    vi.advanceTimersByTime(100);
    expect(repo.load().startDateISO).toBe('2026-05-05');
    // flush() writes any pending state immediately.
    cached.save({ ...emptyAppState(), startDateISO: '2026-06-06' });
    cached.flush();
    expect(repo.load().startDateISO).toBe('2026-06-06');
    // flush with nothing pending is a safe no-op.
    expect(() => cached.flush()).not.toThrow();
  });

  it('reload() re-reads repository changes into the cache (N2)', () => {
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    repo.save({ ...emptyAppState(), startDateISO: '2026-01-01' });
    const cached = new CachedStateStore(repo);
    expect(cached.get().startDateISO).toBe('2026-01-01');
    // Another tab / sync restore writes storage directly.
    repo.save({ ...emptyAppState(), startDateISO: '2026-02-02' });
    expect(cached.get().startDateISO).toBe('2026-01-01'); // stale cache (N2)
    cached.reload();
    expect(cached.get().startDateISO).toBe('2026-02-02');
  });

  it('reload() recovers from a pre-init empty read (N1 boot race)', () => {
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    const cached = new CachedStateStore(repo);
    // The very first get() ran while storage hydration was still in flight, so
    // the repo read an empty state and cached it permanently.
    expect(cached.get().startDateISO).toBeNull();
    // Hydration finishes; the repo now has real data.
    kv.setItem(STATE_KEY, JSON.stringify({ ...emptyAppState(), startDateISO: '2026-09-09' }));
    expect(cached.get().startDateISO).toBeNull(); // still the poisoned cache
    cached.reload();
    expect(cached.get().startDateISO).toBe('2026-09-09');
  });

  it('reload() before first get() still hydrates the cache', () => {
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    repo.save({ ...emptyAppState(), startDateISO: '2026-10-10' });
    const cached = new CachedStateStore(repo);
    cached.reload();
    expect(cached.get().startDateISO).toBe('2026-10-10');
  });
});

/** A state big enough (after the 200-entry normalization cap) to exceed the
 *  3.5MB serialized save budget and force the quota-trim path. */
function oversizedState(): AppState {
  const state = emptyAppState();
  state.memory = { entries: [], summaries: [], lastSummarizedAt: null };
  for (let i = 0; i < 200; i++) {
    state.memory.entries.push({
      id: `e${i}`,
      type: 'observation' as const,
      content: `long note ${i} `.repeat(3000),
      importance: 0.5,
      source: 'ai' as const,
      createdAt: '2026-07-01',
      summarized: false,
      context: { tags: [] },
    });
  }
  return state;
}

describe('prune notice (M7)', () => {
  it('surfaces a one-time notice when a save had to trim memory', () => {
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    expect(repo.consumePruneNotice()).toBeNull();
    repo.save(oversizedState());
    expect(repo.consumePruneNotice()).toContain('Storage was full');
    // One-shot: a second consume returns null (notice is cleared).
    expect(repo.consumePruneNotice()).toBeNull();
  });

  it('does not raise a notice for normal-sized saves', () => {
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    repo.save(emptyAppState());
    expect(repo.consumePruneNotice()).toBeNull();
  });

  it('CachedStateStore delegates the one-shot notice after a flushed save', () => {
    const kv = memoryStore();
    const repo = new LocalStateRepository(kv);
    const cached = new CachedStateStore(repo);
    cached.save(oversizedState());
    cached.flush(); // debounced write lands now → trim + notice
    expect(cached.consumePruneNotice()).toContain('Storage was full');
    expect(cached.consumePruneNotice()).toBeNull();
  });
});
