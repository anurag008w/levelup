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
