/**
 * Splits a single AI reply into separate "message bubbles" at paragraph
 * breaks, so a long answer reads like a few short human messages instead of
 * one wall of text.
 *
 * Purely presentational — the underlying ChatMessage keeps its full content
 * (copy / edit / regenerate / download all use the complete text).
 *
 * Rules:
 * - A paragraph break is one or more blank lines (`\n\s*\n`). Tight lines
 *   joined by a single newline (markdown tables, lists, addresses) stay in
 *   one bubble so their markdown rendering never breaks.
 * - Fenced code blocks are protected first: blank lines inside ``` blocks
 *   never split the code across bubbles.
 */

const FENCE_RE = /```[\s\S]*?```/g;
// Private-use unicode marker — effectively never appears in LLM output, and
// (unlike ASCII control chars) passes the no-control-regex linter rule.
const FENCE_PLACEHOLDER = (i: number) => `\uE000F${i}\uE000`;
const RESTORE_RE = /\uE000F(\d+)\uE000/g;
// A paragraph that is *only* a markdown horizontal rule (---, ***, ___) is a
// section separator, not content — it should never become its own bubble.
const HR_ONLY_RE = /^ {0,3}([-*_])( *\1){2,} *$/;

/** Splits a completed reply into bubble texts at paragraph breaks. */
export function splitReplyIntoBubbles(text: string): string[] {
  if (!text.trim()) return [];
  // Protect fenced code blocks so their internal blank lines never split a
  // single code block across bubbles.
  const fences: string[] = [];
  const masked = text.replace(FENCE_RE, (block) => {
    fences.push(block);
    return FENCE_PLACEHOLDER(fences.length - 1);
  });
  return masked
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !HR_ONLY_RE.test(part))
    .map((part) => part.replace(RESTORE_RE, (_, i) => fences[Number(i)] ?? ''));
}

/**
 * Reveal pacing shared by the chat UI and the AI-reply notification.
 *
 * A fresh reply is revealed like a person sending short messages one at a
 * time: a fixed "thinking" pause before the first paragraph lands, then a
 * random 3–8s pause before every next paragraph. The notification uses the
 * SAME schedule: at every bubble's reveal moment it fires an update (same
 * notification id = merge), so it lands bubble-by-bubble and ends as the full
 * merged reply — no matter how long the reply is.
 */
export const FIRST_BUBBLE_DELAY_MS = 3000;
/** Fixed thinking pause before the first paragraph lands. */
export const BUBBLE_GAP_MIN_MS = 3000;
/** Extra random range on top of BUBBLE_GAP_MIN_MS for between-paragraph pauses. */
export const BUBBLE_GAP_RANDOM_MS = 5000;

export interface RevealSchedule {
  /** Thinking pause (ms) before the first paragraph appears. */
  firstDelay: number;
  /** Thinking pause (ms) before each subsequent paragraph — one entry per gap. */
  gapDelays: number[];
}

/**
 * Builds the reveal schedule for a reply split into `bubbleCount` bubbles.
 * `rng` is injectable so tests can pin the between-paragraph pauses; the app
 * uses Math.random (matching the "no repeating pattern" feel).
 */
export function computeRevealSchedule(bubbleCount: number, rng: () => number = Math.random): RevealSchedule {
  const gapDelays: number[] = [];
  for (let i = 1; i < bubbleCount; i++) {
    gapDelays.push(BUBBLE_GAP_MIN_MS + rng() * BUBBLE_GAP_RANDOM_MS);
  }
  return { firstDelay: FIRST_BUBBLE_DELAY_MS, gapDelays };
}

/** Total time (ms) until a fully revealed reply — the moment to fire a notification. */
export function totalRevealDelay(schedule: RevealSchedule): number {
  return schedule.firstDelay + schedule.gapDelays.reduce((sum, d) => sum + d, 0);
}

export interface NotificationMessage {
  /** One bubble's text (trimmed). */
  text: string;
  /** Unix ms timestamp when that bubble lands — MessagingStyle ko "sent at" time. */
  at: number;
}

export interface NotificationStep {
  /** When (ms after reply completion) this merged update should fire. */
  delayMs: number;
  /** Newest bubble text — Android collapsed/heads-up body (current message). */
  latest: string;
  /** Merged reply text so far — bubble 0..i joined, ending with the full reply. */
  text: string;
  /** Full conversation so far, each bubble with its real reveal timestamp. */
  messages: NotificationMessage[];
}

/**
 * Builds the notification updates for a reply: one per bubble, at the exact
 * reveal moment of that bubble. `latest` = the newest bubble (for the collapsed
 * body — Android heads-up otherwise keeps showing the first line of a
 * multi-paragraph text), `text` = everything merged so far (for the expandable
 * BigText body, ending with the whole reply), `messages` = the conversation so
 * far with real reveal timestamps (for the native MessagingStyle expand —
 * scrollable, full-length). Same sessionId → same notification id on the
 * native side, so every step updates/merges into one notification.
 */
export function buildNotificationSteps(
  bubbles: string[],
  schedule: RevealSchedule,
  now = Date.now(),
): NotificationStep[] {
  const delays: number[] = [];
  let delay = schedule.firstDelay;
  for (let i = 0; i < bubbles.length; i++) {
    delays.push(delay);
    if (i + 1 < bubbles.length) {
      delay += schedule.gapDelays[i];
    }
  }
  const bubbleTexts = bubbles.map((b) => b.trim());
  return delays.map((delayMs, i) => ({
    delayMs,
    latest: bubbleTexts[i],
    text: bubbleTexts
      .slice(0, i + 1)
      .join('\n\n')
      .trim(),
    messages: bubbleTexts.slice(0, i + 1).map((text, j) => ({ text, at: now + delays[j] })),
  }));
}
