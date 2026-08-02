import type { AppState } from '../../core/domain/state';
import type { MemoryEntry, MemoryStore, MemoryType } from '../../core/domain/memory';
import {
  emptyMemoryStore,
  MEMORY_MAX_ENTRIES,
  MEMORY_BYTES_BUDGET,
  normalizeMemoryStore,
  pruneMemoryToBudget,
} from '../../core/domain/memory';
import { SESSION_TAG_PREFIX, sessionMemoryTag } from '../../core/domain/chat-transcript';
import { isoAddDays } from '../habit-engine/dates';
import { isoDate, type Clock } from '../../core/ports/clock';

export interface AddMemoryInput {
  type: MemoryType;
  content: string;
  source: MemoryEntry['source'];
  importance?: number;
  dayNumber?: number;
  habitId?: string;
  tags?: string[];
  /** Marks condensed/rollup entries produced by a summarizer. */
  summarized?: boolean;
  /** Overrides the creation date (used when importing/backfilling). */
  createdAt?: string;
  /** Block group this entry belongs to (e.g. one per chat session). */
  blockId?: string;
  /** Promote straight into long-term memory. */
  longTerm?: boolean;
}

export { MEMORY_MAX_ENTRIES } from '../../core/domain/memory';
export const MEMORY_SUMMARIZE_THRESHOLD = 120;
export const IMPORTANCE_KEEP_VERBATIM = 0.8;

/**
 * Persistent AI memory (M4). Entries are appended to state; when the store
 * grows past the threshold the old, low-importance entries are condensed into
 * rollup summaries. Fully deterministic — no model calls.
 */
export class MemoryService {
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  add(state: AppState, input: AddMemoryInput): AppState {
    const store = state.memory;
    const entry: MemoryEntry = {
      id: uid(),
      type: input.type,
      createdAt: input.createdAt ?? isoDate(this.clock.now()),
      content: input.content,
      importance: clamp01(input.importance ?? 0.5),
      summarized: input.summarized ?? false,
      source: input.source,
      blockId: input.blockId,
      longTerm: input.longTerm ?? false,
      context: {
        ...(input.dayNumber !== undefined ? { dayNumber: input.dayNumber } : {}),
        ...(input.habitId !== undefined ? { habitId: input.habitId } : {}),
        tags: input.tags ?? [],
      },
    };
    const next: MemoryStore = { ...store, entries: [...store.entries, entry] };
    const needsSummarize = next.entries.length > MEMORY_SUMMARIZE_THRESHOLD;
    const withSummaries = needsSummarize ? this.summarize(next) : next;
    // Count cap first, then a byte budget so a bloated memory can never push
    // the whole app state past the localStorage quota (silent data loss).
    return { ...state, memory: pruneMemoryToBudget(prune(withSummaries), MEMORY_BYTES_BUDGET) };
  }

  /** Condense old low-importance entries into weekly rollups. Deterministic. */
  summarize(store: MemoryStore): MemoryStore {
    const now = isoDate(this.clock.now());
    const entries = store.entries;
    // User-visible chat history must NEVER be rolled up, regardless of age or
    // importance: raw transcript archives (source 'system' conversation
    // entries) AND AI-condensed chat blocks (source 'ai' + 'ai-summary' tag).
    // Rolling either up would silently erase the read-only chat archive shown
    // in the memory panel.
    const isArchive = (e: MemoryEntry): boolean =>
      (e.type === 'conversation' && e.source === 'system') || e.context.tags.includes('ai-summary');
    const keepVerbatim = entries.filter((e) => isArchive(e) || e.importance >= IMPORTANCE_KEEP_VERBATIM || !isOld(e, now));
    const condenseCandidates = entries.filter((e) => !isArchive(e) && e.importance < IMPORTANCE_KEEP_VERBATIM && isOld(e, now));

    const byWeek = new Map<string, MemoryEntry[]>();
    for (const e of condenseCandidates) {
      const key = weekStart(e.createdAt);
      const list = byWeek.get(key) ?? [];
      list.push(e);
      byWeek.set(key, list);
    }

    const rollups: MemoryEntry[] = [];
    for (const [week, group] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const important = group
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 3)
        .map((e) => truncate(e.content, 120))
        .join(' | ');
      if (!important) continue;
      rollups.push({
        id: uid(),
        type: 'summary',
        createdAt: week,
        content: `Week of ${week}: ${important}`,
        importance: 0.5,
        summarized: true,
        source: 'system',
        context: { tags: ['rollup', ...group.flatMap((e) => e.context.tags).slice(0, 6)] },
      });
    }

    return {
      entries: keepVerbatim,
      summaries: [...rollups, ...store.summaries].slice(0, 50),
      lastSummarizedAt: now,
    };
  }

  /** Entries relevant to a query, newest + most important first. */
  relevant(state: AppState, opts: { types?: MemoryEntry['type'][]; max?: number; sinceDays?: number } = {}): MemoryEntry[] {
    const { types, max = 10, sinceDays } = opts;
    const cutoff = sinceDays !== undefined ? isoAddDays(isoDate(this.clock.now()), -sinceDays) : null;
    const all = [...state.memory.summaries, ...state.memory.entries].filter((e) => {
      if (types && !types.includes(e.type)) return false;
      if (cutoff && e.createdAt < cutoff) return false;
      return true;
    });
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.importance - a.importance)
      .slice(0, max);
  }

  /** Edits a specific entry (in entries or summaries) — user-controlled memory. */
  update(state: AppState, id: string, patch: Partial<Pick<MemoryEntry, 'content' | 'importance' | 'type'>>): AppState {
    const mapEntry = (e: MemoryEntry): MemoryEntry => (e.id === id ? { ...e, ...patch } : e);
    return {
      ...state,
      memory: {
        ...state.memory,
        entries: state.memory.entries.map(mapEntry),
        summaries: state.memory.summaries.map(mapEntry),
      },
    };
  }

  /** Pin/unpin specific entries as long-term memory. */
  setLongTerm(state: AppState, ids: string[], longTerm: boolean): AppState {
    const target = new Set(ids);
    const mapEntry = (e: MemoryEntry): MemoryEntry => (target.has(e.id) ? { ...e, longTerm } : e);
    return {
      ...state,
      memory: {
        ...state.memory,
        entries: state.memory.entries.map(mapEntry),
        summaries: state.memory.summaries.map(mapEntry),
      },
    };
  }

  /**
   * Deterministic long-term curation: anything already pinned stays; goals,
   * preferences, key observations and high-importance summaries are promoted.
   * The AI (via memory tools) can override by editing/pinning entries directly.
   */
  curateLongTerm(state: AppState): AppState {
    const shouldPin = (e: MemoryEntry): boolean =>
      e.longTerm === true ||
      e.type === 'goal' ||
      e.type === 'preference' ||
      (e.type === 'observation' && e.importance >= IMPORTANCE_KEEP_VERBATIM) ||
      e.importance >= IMPORTANCE_KEEP_VERBATIM;
    const mapEntry = (e: MemoryEntry): MemoryEntry => (shouldPin(e) ? { ...e, longTerm: true } : e);
    return {
      ...state,
      memory: {
        ...state.memory,
        entries: state.memory.entries.map(mapEntry),
        summaries: state.memory.summaries.map(mapEntry),
      },
    };
  }

  /** One summary block per chat: all points share the same blockId. */
  listBlocks(state: AppState): Array<{ blockId: string; entries: MemoryEntry[]; updatedAt: string }> {
    const byBlock = new Map<string, MemoryEntry[]>();
    for (const entry of [...state.memory.summaries, ...state.memory.entries]) {
      const id = entry.blockId;
      if (!id) continue;
      const list = byBlock.get(id) ?? [];
      list.push(entry);
      byBlock.set(id, list);
    }
    return [...byBlock.entries()]
      .map(([blockId, entries]) => ({
        blockId,
        entries: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        updatedAt: entries.reduce((latest, e) => (e.createdAt > latest ? e.createdAt : latest), ''),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Deletes a specific entry (from entries or summaries) by id. */
  remove(state: AppState, id: string): AppState {
    return {
      ...state,
      memory: {
        ...state.memory,
        entries: state.memory.entries.filter((e) => e.id !== id),
        summaries: state.memory.summaries.filter((e) => e.id !== id),
      },
    };
  }

  /**
   * Deletes conversation entries tagged with a session id (either the bare id
   * or the canonical "session:<id>" form). Used to clean legacy/stale dumps
   * before writing a fresh archive.
   */
  removeConversationByTag(state: AppState, tag: string): AppState {
    const matches = (e: MemoryEntry): boolean =>
      e.type === 'conversation' &&
      (e.context.tags.includes(tag) || e.context.tags.includes(sessionMemoryTag(tag)) || e.context.tags.includes(`${SESSION_TAG_PREFIX}${tag}`));
    return {
      ...state,
      memory: {
        ...state.memory,
        entries: state.memory.entries.filter((e) => !matches(e)),
      },
    };
  }

  /**
   * Removes only the raw read-only transcript archive for a session (source
   * 'system'), leaving AI-condensed summary blocks untouched. Used when
   * replacing/stale-dropping an archive.
   */
  removeTranscriptArchive(state: AppState, sessionId: string): AppState {
    const tag = sessionMemoryTag(sessionId);
    return {
      ...state,
      memory: {
        ...state.memory,
        entries: state.memory.entries.filter(
          (e) => !(e.type === 'conversation' && e.source === 'system' && e.context.tags.includes(tag)),
        ),
      },
    };
  }

  clear(state: AppState): AppState {
    return { ...state, memory: emptyMemoryStore() };
  }

  /**
   * Serializes the whole memory store into a portable JSON backup (envelope +
   * versioned so importMemory can validate it). Non-memory state is not
   * included — restore merges into whatever state the app currently has.
   */
  exportMemory(state: AppState): string {
    return JSON.stringify(
      {
        app: 'jee-human-os',
        kind: 'ai-memory-backup',
        version: 1,
        exportedAt: isoDate(this.clock.now()),
        memory: state.memory,
      },
      null,
      2,
    );
  }

  /**
   * Replaces the current memory with a validated backup produced by
   * exportMemory (or any object with a `memory` field). Corrupt/invalid
   * entries are dropped silently; the rest of the app state is preserved.
   * Throws on malformed JSON.
   */
  importMemory(state: AppState, json: string): AppState {
    const parsed = JSON.parse(json) as { memory?: unknown };
    return { ...state, memory: normalizeMemoryStore(parsed.memory) };
  }
}

function isOld(e: MemoryEntry, nowISO: string): boolean {
  return e.createdAt < isoAddDays(nowISO, -7);
}

function weekStart(dateISO: string): string {
  // Pure UTC arithmetic so the result matches UTC memory keys (local-time
  // setDate + toISOString shifts the Monday back by one day on non-UTC machines).
  const d = new Date(dateISO + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 (Sun) .. 6
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); // back to Monday
  return isoDate(d);
}

function prune(store: MemoryStore): MemoryStore {
  const sorted = [...store.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = sorted.slice(0, MEMORY_MAX_ENTRIES);
  const keptHabits = new Set(kept.map((e) => e.context.habitId).filter((x): x is string => Boolean(x)));
  const extra: MemoryEntry[] = [];
  for (const e of sorted) {
    if (extra.length >= 20) break;
    const hid = e.context.habitId;
    if (hid && !keptHabits.has(hid) && !kept.includes(e)) {
      keptHabits.add(hid);
      extra.push(e);
    }
  }
  return { ...store, entries: [...kept, ...extra] };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
