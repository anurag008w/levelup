// Persistent AI memory. Used for personalisation, recovery planning and
// AI observations. Summarized automatically when it grows too large.

export type MemoryType =
  | 'conversation'
  | 'observation'
  | 'progression'
  | 'journal'
  | 'goal'
  | 'preference'
  | 'summary';

export type MemorySource = 'user' | 'ai' | 'system';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  createdAt: string; // ISO date
  content: string;
  /** 0..1 — higher entries are preserved verbatim during summarization. */
  importance: number;
  /** True when produced by the summarizer (condensed memory). */
  summarized: boolean;
  source: MemorySource;
  context: {
    dayNumber?: number;
    habitId?: string;
    tags: string[];
  };
  /**
   * Block grouping. Conversation summaries share one blockId per chat session
   * so the memory history can render them as a single "block" and curate
   * "the important part of a block" into long-term memory.
   */
  blockId?: string;
  /** Pinned into long-term memory. The AI/user can promote or demote entries. */
  longTerm?: boolean;
}

export interface MemoryStore {
  entries: MemoryEntry[];
  /** Rolled-up condensed memories. */
  summaries: MemoryEntry[];
  lastSummarizedAt: string | null;
}

export function emptyMemoryStore(): MemoryStore {
  return { entries: [], summaries: [], lastSummarizedAt: null };
}

export const MEMORY_MAX_ENTRIES = 200;
export const MEMORY_MAX_SUMMARIES = 50;

/**
 * Safety budget for the serialized memory store. localStorage is shared with
 * the rest of the app state (~5MB typical quota); memory must never be allowed
 * to balloon past this or the whole app silently stops persisting.
 */
export const MEMORY_BYTES_BUDGET = 2_500_000;

export function estimateMemoryBytes(store: MemoryStore): number {
  return JSON.stringify(store).length;
}

/**
 * Deterministic byte-budget prune. Drops entries until the serialized store
 * fits under `budgetBytes`, preferring to free the biggest blobs first:
 *  1) raw transcript archives (source 'system') — largest first,
 *  2) oldest, lowest-importance non-long-term, non-summarized entries.
 * Rollups, AI-condensed blocks and pinned facts are preserved as long as
 * possible. Returns an identical store when already within budget.
 */
export function pruneMemoryToBudget(store: MemoryStore, budgetBytes: number): MemoryStore {
  if (estimateMemoryBytes(store) <= budgetBytes) return store;
  let entries = [...store.entries];

  const sizeOf = (list: MemoryEntry[]): number => estimateMemoryBytes({ ...store, entries: list });
  const isArchive = (e: MemoryEntry): boolean => e.type === 'conversation' && e.source === 'system';

  // 1) Largest raw transcript archives first (they are the big blobs).
  const archives = entries.filter(isArchive).sort((a, b) => b.content.length - a.content.length);
  for (const archive of archives) {
    entries = entries.filter((e) => e.id !== archive.id);
    if (sizeOf(entries) <= budgetBytes) return { ...store, entries };
  }

  // 2) Oldest, lowest-importance non-long-term entries (never AI blocks/rollups).
  const droppable = entries
    .filter((e) => !isArchive(e) && e.longTerm !== true && !e.summarized)
    .sort((a, b) => a.importance - b.importance || a.createdAt.localeCompare(b.createdAt));
  for (const drop of droppable) {
    entries = entries.filter((e) => e.id !== drop.id);
    if (sizeOf(entries) <= budgetBytes) return { ...store, entries };
  }

  return { ...store, entries };
}

/** Shape guard for a single memory entry — used by state + backup validation. */
export function isValidMemoryEntry(e: unknown): e is MemoryEntry {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.content === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.importance === 'number' &&
    typeof r.type === 'string' &&
    typeof r.source === 'string' &&
    typeof r.context === 'object' &&
    r.context !== null &&
    Array.isArray((r.context as { tags?: unknown }).tags) &&
    ((r.context as { tags: unknown[] }).tags.every((t) => typeof t === 'string'))
  );
}

/**
 * Defensively normalizes whatever came out of storage / a backup file into a
 * valid MemoryStore: corrupt entries are dropped, arrays are capped. Never
 * throws.
 */
export function normalizeMemoryStore(raw: unknown): MemoryStore {
  if (typeof raw !== 'object' || raw === null) return emptyMemoryStore();
  const r = raw as Record<string, unknown>;
  const entries = Array.isArray(r.entries) ? r.entries.filter(isValidMemoryEntry) : [];
  const summaries = Array.isArray(r.summaries) ? r.summaries.filter(isValidMemoryEntry) : [];
  return {
    entries: entries.slice(0, MEMORY_MAX_ENTRIES),
    summaries: summaries.slice(0, MEMORY_MAX_SUMMARIES),
    lastSummarizedAt: typeof r.lastSummarizedAt === 'string' ? r.lastSummarizedAt : null,
  };
}
