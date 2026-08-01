// Strips internal metadata (per-message send timestamps like "[05:42 PM]")
// that a model may echo, quote or mimic out of its reply. Weak models
// frequently leak these into the user-visible answer even when the system
// prompt forbids it, so this deterministic pass guarantees they never reach
// the user — while live streaming and in the persisted message.

/** Matches a complete bracketed clock time, e.g. [05:42 PM], [11:01 am], [9:30], [05:42:33 PM]. */
const TIMESTAMP_PATTERN = /\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]?\.?)?\s*\]/g;

/**
 * Matches any prefix of a bracketed clock time (no closing bracket yet).
 * Used to hold back a trailing partial token during streaming until we know
 * whether it completes into a timestamp.
 */
const PARTIAL_TIMESTAMP_PREFIX = /^\[\s*\d{0,2}(?::\d{0,2})?(?::\d{0,2})?\s*(?:[AaPp]\.?\s?[Mm]?\.?)?\s*$/;

/**
 * Sanitizes a complete text: strips every bracketed clock time and also drops
 * any trailing partial timestamp prefix (the one-shot answer is final, so no
 * more deltas will arrive to complete it).
 */
export function sanitizeTimestampLeaks(text: string): string {
  const stripped = text.replace(TIMESTAMP_PATTERN, '');
  const lastBracket = stripped.lastIndexOf('[');
  if (lastBracket === -1) return stripped;
  const suffix = stripped.slice(lastBracket);
  return PARTIAL_TIMESTAMP_PREFIX.test(suffix) ? stripped.slice(0, lastBracket) : stripped;
}

/**
 * Stateful streaming sanitizer. Feed each raw delta; it returns the safe
 * portion and holds back any trailing text that could still grow into a
 * timestamp token. Call `flush()` after the stream ends.
 */
export interface StreamSanitizer {
  push(delta: string): string;
  flush(): string;
}

export function createStreamSanitizer(): StreamSanitizer {
  let hold = '';
  return {
    push(delta: string): string {
      const combined = hold + delta;
      const stripped = combined.replace(TIMESTAMP_PATTERN, '');
      const lastBracket = stripped.lastIndexOf('[');
      if (lastBracket === -1) {
        hold = '';
        return stripped;
      }
      const suffix = stripped.slice(lastBracket);
      if (PARTIAL_TIMESTAMP_PREFIX.test(suffix)) {
        hold = suffix;
        return stripped.slice(0, lastBracket);
      }
      hold = '';
      return stripped;
    },
    flush(): string {
      const remaining = hold;
      hold = '';
      return remaining;
    },
  };
}
