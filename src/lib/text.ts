/**
 * Meaning-safe text helpers. Used everywhere the app compresses or truncates
 * user content (memory rollups, AI prompt recall, transcript bounds) so the
 * meaning of the last kept point is never cut mid-word.
 */

/**
 * Truncates text to at most `max` chars without slicing the meaning of the
 * last point mid-word. Prefers to end at a complete sentence / line boundary;
 * falls back to a word boundary; only hard-cuts when no boundary exists in the
 * usable window. Never returns an empty string for non-empty input.
 */
export function truncateMeaningful(text: string, max: number): string {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const window = s.slice(0, max);
  const minUseful = Math.floor(max * 0.5);
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('\n'));
  const word = Math.max(window.lastIndexOf(' | '), window.lastIndexOf(', '), window.lastIndexOf(' '));
  let cut: string;
  if (sentence >= minUseful) cut = window.slice(0, sentence + 1);
  else if (word >= minUseful) cut = window.slice(0, word + 1);
  else cut = window;
  return `${cut.trimEnd()}…`;
}
