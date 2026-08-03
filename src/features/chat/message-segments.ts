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
