// AI memory summarization protocol. The AI reads EVERY unread chat plus the
// last 7 days of already-summarized memory and condenses them into compact
// Hinglish memory blocks. Each block is stored as its own memory entry and
// long-term blocks get pinned. Parsing here is fully deterministic — the model
// only ever has to emit JSON (plain "----"-separated blocks work as fallback).

export interface MemoryBlock {
  /** Optional short label shown above the block. */
  title?: string;
  /** Compact memory points — max 8 per block. */
  lines: string[];
  /** True when this block should be pinned into long-term memory. */
  longTerm: boolean;
  tags: string[];
}

export const MEMORY_SUMMARY_INSTRUCTIONS = `You are the memory curator of the LevelUp JEE coach app. Read finished coaching chats and condense them into durable, structured memory blocks the AI coach will remember across future sessions.

Reply with ONLY ONE JSON object. No prose, no markdown fences, no explanations.

JSON format:
{"blocks":[{"title":"short label","lines":["point","point","point"],"longTerm":true,"tags":["topic"]}]}

Rules:
1. Read EVERY chat listed under "Unread chats" below, fully. Extract only what matters for a JEE student: goals, weak/strong topics, mistakes, preferences, study style, exam targets, important personal facts, commitments.
2. "Previous memory (last 7 days)" is listed too — continuity only. Do NOT repeat facts already present there.
3. PRESERVE MEANING EXACTLY. Never change, guess, add or fabricate facts. Numbers, dates, marks, percentages, subject/topic names, exam names, preferences, commitments and names must stay EXACTLY as the student wrote them. Never drop negations or qualifiers ("nhi", "sirf", "except", "jab tak", "not", "sometimes", "almost"). If a point is unclear, SKIP it — never guess.
4. Each block has AT MOST 8 lines. Each line is one compact, self-contained Hinglish memory point. Aim for ~12 words, but that is a GUIDE — never shorten a point if it changes or loses the meaning; a longer accurate line is always better than a shorter wrong one.
5. Separate blocks with a line containing only "----". If a block would need more than 8 lines, split it into a NEW block starting after a "----" line. Never go above 8 lines inside one block.
6. Keep different topics/sessions in DIFFERENT blocks. Each block is one independent memory unit, stored as its own separate memory entry.
7. "longTerm": true ONLY for facts the coach must never forget (goals, preferences, strengths/weaknesses, exam targets, commitments). STRICT and RARE — at most 2 longTerm blocks per run. When in doubt keep "longTerm": false; the student can always pin a block later. longTerm blocks are pinned into long-term memory.
8. Skip greetings, small talk and generic encouragement. Do not output empty blocks.`;

/** Parses a model reply into memory blocks — JSON first, plain "----" blocks as fallback. */
export function parseMemoryBlocks(text: string): MemoryBlock[] {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];

  const parsed = tryJsonObject(trimmed);
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && 'blocks' in parsed) {
    const raw = (parsed as { blocks?: unknown }).blocks;
    if (Array.isArray(raw)) {
      const blocks = parseJsonBlocks(raw);
      if (blocks.length > 0) return blocks;
    }
  }

  // Plain-text fallback only when the reply actually uses "----" block
  // separators — a random prose reply is NOT treated as memory.
  if (!/^\s*-{3,}\s*$/m.test(trimmed)) return [];
  return parsePlainBlocks(trimmed);
}

/** Max memory points a single block may carry (matches the prompt rule). */
export const MAX_BLOCK_LINES = 8;
export const MAX_BLOCKS = 30;

/**
 * Deterministic long-term gate for AI memory blocks. Models tend to mark
 * nearly every block `longTerm:true`; this keeps only blocks that actually
 * carry a durable coaching fact (goal, target, preference, strength/weakness,
 * commitment, exam plan, marks/score). Anything else is demoted to normal
 * memory — the student can always pin it manually later.
 */
const LONG_TERM_SIGNAL =
  /(goal|target|aim|lakshya|chahiye|want|dream|sapna|prefer|pasand|acha lagta|likes|weak|strong|strength|weakness|dikkat|problem|mushkil|aata hai|nahi aata|commit|roz|daily|har roz|karna hai|jee|iit|nit|rank|crack|mock|exam|score|marks)/i;

export function shouldPinMemoryBlock(block: Pick<MemoryBlock, 'title' | 'lines'>): boolean {
  const text = [block.title ?? '', ...block.lines].join(' ').toLowerCase();
  return LONG_TERM_SIGNAL.test(text);
}

function parseJsonBlocks(raw: unknown[]): MemoryBlock[] {
  const blocks: MemoryBlock[] = [];
  for (const item of raw.slice(0, MAX_BLOCKS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const b = item as Record<string, unknown>;
    const lines = toStrArray(b.lines).slice(0, MAX_BLOCK_LINES);
    if (lines.length === 0) continue;
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : undefined;
    blocks.push({
      ...(title ? { title } : {}),
      lines,
      longTerm: b.longTerm === true,
      tags: toStrArray(b.tags).slice(0, 8),
    });
  }
  return blocks;
}

/** Fallback: plain text split on lines containing only dashes ("----"). */
function parsePlainBlocks(text: string): MemoryBlock[] {
  const groups = text.split(/^\s*-{3,}\s*$/m);
  const blocks: MemoryBlock[] = [];
  for (const group of groups.slice(0, MAX_BLOCKS)) {
    const lines = group
      .split('\n')
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, MAX_BLOCK_LINES);
    if (lines.length === 0) continue;
    blocks.push({ lines, longTerm: false, tags: [] });
  }
  return blocks;
}

function tryJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x): x is string => x.length > 0)
    .slice(0, MAX_BLOCK_LINES);
}
