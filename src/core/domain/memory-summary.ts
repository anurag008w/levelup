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
5. Separate blocks with a line containing only "----". If a block would need more than 8 lines, split it into a NEW block starting after a "----" line. Never go above 8 lines inside one block. (Safety: the app auto-splits any block that still exceeds 8 lines — extra lines are NEVER dropped, so don't worry about losing points.)
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
/** Hard ceiling on stored blocks per run — a runaway reply can never balloon memory. */
export const MAX_BLOCKS = 50;

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
  const out: MemoryBlock[] = [];
  for (const item of raw) {
    if (out.length >= MAX_BLOCKS) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const b = item as Record<string, unknown>;
    const lines = toStrArray(b.lines);
    if (lines.length === 0) continue;
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : undefined;
    const base = {
      ...(title ? { title } : {}),
      longTerm: b.longTerm === true,
      tags: toStrArray(b.tags).slice(0, 8),
    };
    for (const block of splitIntoBlocks(lines, base)) {
      if (out.length >= MAX_BLOCKS) break;
      out.push(block);
    }
  }
  return out;
}

/** Fallback: plain text split on lines containing only dashes ("----"). */
function parsePlainBlocks(text: string): MemoryBlock[] {
  const groups = text.split(/^\s*-{3,}\s*$/m);
  const out: MemoryBlock[] = [];
  for (const group of groups) {
    if (out.length >= MAX_BLOCKS) break;
    const lines = group
      .split('\n')
      .map((l) => stripListMarker(l))
      .filter(Boolean);
    if (lines.length === 0) continue;
    for (const block of splitIntoBlocks(lines, { longTerm: false, tags: [] })) {
      if (out.length >= MAX_BLOCKS) break;
      out.push(block);
    }
  }
  return out;
}

/**
 * Splits a block's lines into as many compact blocks as needed — NEVER drops a
 * point. The model is told to keep blocks <= MAX_BLOCK_LINES and separate
 * topics with "----", but models routinely exceed the line cap; before this
 * the overflow lines were silently discarded, losing meaning. Continuation
 * blocks inherit the original longTerm/tags so pinning is consistent.
 */
function splitIntoBlocks(
  lines: string[],
  base: { title?: string; longTerm: boolean; tags: string[] },
): MemoryBlock[] {
  if (lines.length <= MAX_BLOCK_LINES) return [{ ...base, lines }];
  const blocks: MemoryBlock[] = [];
  for (let i = 0; i < lines.length && blocks.length < MAX_BLOCKS; i += MAX_BLOCK_LINES) {
    blocks.push({ ...base, lines: lines.slice(i, i + MAX_BLOCK_LINES) });
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
  // All lines are kept — overflow is split into extra blocks by splitIntoBlocks
  // instead of being dropped, so no student point is ever lost.
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x): x is string => x.length > 0)
    .slice(0, MAX_BLOCK_LINES * MAX_BLOCKS);
}

/**
 * Removes ONLY markdown list markers ("- x", "* x", "1. x", "1) x"). A naive
 * `^[-*\d.)\s]+` strip eats real content that starts with digits — e.g. a fact
 * line "140 marks aaye" or "9.5 CGPA mila" lost its number. Digits only count
 * as a marker when followed by "." or ")".
 */
export function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
}
