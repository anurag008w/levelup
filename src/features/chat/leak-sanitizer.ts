// Strips internal metadata (timestamps + tool protocol snippets) that models
// may echo, quote or mimic. This deterministic pass guarantees those raw
// implementation details never reach the user — while live streaming and in
// persisted messages.

/** Matches a complete bracketed clock time, e.g. [05:42 PM], [11:01 am], [9:30], [05:42:33 PM]. */
const TIMESTAMP_PATTERN = /\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]?\.?)?\s*\]/g;

/** Matches any prefix of a bracketed clock time (no closing bracket yet). */
const PARTIAL_TIMESTAMP_PREFIX = /^\[\s*\d{0,2}(?::\d{0,2})?(?::\d{0,2})?\s*(?:[AaPp]\.?\s?[Mm]?\.?)?\s*$/;

/** Raw internal tool traces that should never appear in assistant messages. */
const TOOL_TRACE_LINE_PATTERN = /^\s*(?:tool\s*:\s*[\w-]+|call_plan_manager_[\w-]+\s*\(|plan_manager\.[\w-]+\s*\(|<tool_call>|<\/tool_call>|```\s*(?:tool|json)?\s*$)/i;
const TOOL_CALL_OBJECT_PATTERN = /^\s*(?:call_plan_manager_[\w-]+|plan_manager\.[\w-]+)\s*\([\s\S]*?\)\s*;?\s*$/gim;
const TOOL_JSON_ACTION_PATTERN = /^\s*\{\s*"action"\s*:\s*"(?:getPlan|getRange|addTask|bulkAddTasks|removeTask|bulkRemoveTasks|setDayMode|editTask|markDone|bulkMarkDone|getAllTasks|getTaskBank|editAnyTask|deleteAnyTask|createBlock|deleteBlock|activateBlock|editBlock|listBlocks|extendBlock)"[\s\S]*?\}\s*,?\s*$/gim;
const TOOL_JSON_BATCH_PATTERN = /^\s*\{\s*"actions"\s*:\s*\[[\s\S]*?\]\s*\}\s*,?\s*$/gim;

/**
 * Sanitizes a complete text: strips timestamps and raw tool-call traces.
 */
export function sanitizeAssistantLeaks(text: string): string {
  return sanitizeToolLeaks(sanitizeTimestampLeaks(text));
}

/**
 * Sanitizes a complete text: strips every bracketed clock time and also drops
 * any trailing partial timestamp prefix.
 */
export function sanitizeTimestampLeaks(text: string): string {
  const stripped = text.replace(TIMESTAMP_PATTERN, '');
  const lastBracket = stripped.lastIndexOf('[');
  if (lastBracket === -1) return stripped;
  const suffix = stripped.slice(lastBracket);
  return PARTIAL_TIMESTAMP_PREFIX.test(suffix) ? stripped.slice(0, lastBracket) : stripped;
}

export function sanitizeToolLeaks(text: string): string {
  const withoutCallObjects = text
    .replace(TOOL_CALL_OBJECT_PATTERN, '')
    .replace(TOOL_JSON_BATCH_PATTERN, '')
    .replace(TOOL_JSON_ACTION_PATTERN, '');
  return withoutCallObjects
    .split('\n')
    .filter((line) => !TOOL_TRACE_LINE_PATTERN.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * Stateful streaming sanitizer. Feed each raw delta; it returns the safe
 * portion and holds back any trailing text that could still grow into a
 * timestamp or raw tool-call trace. Call `flush()` after the stream ends.
 */
export interface StreamSanitizer {
  push(delta: string): string;
  flush(): string;
}

function isPartialToolTracePrefix(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  if (trimmed.length < 2) return false;
  const prefixes = ['tool:', 'call_plan_manager_', 'plan_manager.'];
  return prefixes.some((prefix) => prefix.startsWith(trimmed));
}

export function createStreamSanitizer(): StreamSanitizer {
  let hold = '';
  return {
    push(delta: string): string {
      const combined = hold + delta;
      const stripped = sanitizeToolLeaks(combined.replace(TIMESTAMP_PATTERN, ''));
      const lastBracket = stripped.lastIndexOf('[');
      if (lastBracket !== -1) {
        const timestampSuffix = stripped.slice(lastBracket);
        if (PARTIAL_TIMESTAMP_PREFIX.test(timestampSuffix)) {
          hold = timestampSuffix;
          return stripped.slice(0, lastBracket);
        }
      }
      const lastBreak = Math.max(stripped.lastIndexOf('\n'), stripped.lastIndexOf('\r'));
      const prefix = lastBreak === -1 ? '' : stripped.slice(0, lastBreak + 1);
      const suffix = lastBreak === -1 ? stripped : stripped.slice(lastBreak + 1);
      if (isPartialToolTracePrefix(suffix)) {
        hold = suffix;
        return prefix;
      }
      hold = '';
      return stripped;
    },
    flush(): string {
      const remaining = sanitizeAssistantLeaks(hold);
      hold = '';
      return remaining;
    },
  };
}
