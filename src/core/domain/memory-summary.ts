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

/** Parses a model reply into memory blocks — JSON first, markdown/plain blocks as fallback. */
export function parseMemoryBlocks(text: string): MemoryBlock[] {
  // Strip reasoning / think tags if emitted by reasoning models (DeepSeek, etc.)
  let trimmed = (text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!trimmed) return [];

  // 1. Try robust JSON extraction (object or array, with or without markdown fences)
  const parsed = tryJsonAny(trimmed);
  if (parsed !== null) {
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      if ('blocks' in parsed && Array.isArray((parsed as { blocks?: unknown }).blocks)) {
        const blocks = parseJsonBlocks((parsed as { blocks: unknown[] }).blocks);
        if (blocks.length > 0) return blocks;
      } else if ('lines' in parsed && Array.isArray((parsed as { lines?: unknown }).lines)) {
        const blocks = parseJsonBlocks([parsed]);
        if (blocks.length > 0) return blocks;
      }
    } else if (Array.isArray(parsed)) {
      const blocks = parseJsonBlocks(parsed);
      if (blocks.length > 0) return blocks;
    }
  }

  // 2. Plain-text split on "----" block separators
  if (/^\s*-{3,}\s*$/m.test(trimmed)) {
    const plainBlocks = parsePlainBlocks(trimmed);
    if (plainBlocks.length > 0) return plainBlocks;
  }

  // 3. Markdown headers fallback (### Category \n - bullet points)
  if (/^#{1,4}\s+/m.test(trimmed)) {
    const mdBlocks = parseMarkdownHeaderBlocks(trimmed);
    if (mdBlocks.length > 0) return mdBlocks;
  }

  // 4. Clean bullet list fallback (- point \n - point)
  const bulletLines = trimmed
    .split('\n')
    .map((l) => stripListMarker(l))
    .filter((l) => l.length > 0 && !l.startsWith('```') && !l.startsWith('{') && !l.startsWith('}'));
  if (bulletLines.length > 0 && bulletLines.some((l) => l.length > 5)) {
    return splitIntoBlocks(bulletLines, { longTerm: false, tags: [] });
  }

  return [];
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

/** Fallback: Markdown header sections (### Heading \n - Item 1 \n - Item 2). */
function parseMarkdownHeaderBlocks(text: string): MemoryBlock[] {
  const sections = text.split(/(?=^#{1,4}\s+)/m);
  const out: MemoryBlock[] = [];
  for (const sec of sections) {
    if (out.length >= MAX_BLOCKS) break;
    const trimmed = sec.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^#{1,4}\s+(.+)$/m);
    const title = headerMatch ? headerMatch[1].replace(/[*_~`]/g, '').trim() : undefined;
    const body = trimmed.replace(/^#{1,4}\s+.+$/m, '').trim();
    const lines = body
      .split('\n')
      .map((l) => stripListMarker(l))
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    if (lines.length === 0) continue;
    for (const block of splitIntoBlocks(lines, { title, longTerm: false, tags: [] })) {
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

function tryJsonAny(text: string): unknown {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {}

  const objStart = clean.indexOf('{');
  const objEnd = clean.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(clean.slice(objStart, objEnd + 1));
    } catch {}
  }

  const arrStart = clean.indexOf('[');
  const arrEnd = clean.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(clean.slice(arrStart, arrEnd + 1));
    } catch {}
  }

  return null;
}

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
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
