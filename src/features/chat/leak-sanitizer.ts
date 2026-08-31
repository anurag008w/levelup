// Strips internal metadata (timestamps + tool protocol snippets) that models
// may echo, quote or mimic. This deterministic pass guarantees those raw
// implementation details never reach the user — while live streaming and in
// persisted messages.

/** Matches a complete bracketed clock time, e.g. [05:42 PM], [11:01 am], [9:30], [05:42:33 PM]. */
const TIMESTAMP_PATTERN = /\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]?\.?)?\s*\]/g;

/** Matches any prefix of a bracketed clock time (no closing bracket yet). */
const PARTIAL_TIMESTAMP_PREFIX = /^\[\s*\d{0,2}(?::\d{0,2})?(?::\d{0,2})?\s*(?:[AaPp]\.?\s?[Mm]?\.?)?\s*$/;

/** Raw internal tool traces that should never appear in assistant messages. */
const TOOL_TRACE_LINE_PATTERN = /^\s*(?:tool\s*:\s*[\w-]+(?:,[\w-]+)*|call_plan_manager_[\w-]+\s*\(|plan_manager\.[\w-]+\s*\(|<tool_call>|<\/tool_call>|```\s*(?:tool|json)?\s*$)/i;

/** Whole-line function-call echoes such as `/add_tasks(tasks=[...])` (OpenAI-style slash call). */
const SLASH_TOOL_CALL_LINE_PATTERN = /^\s*\/[a-zA-Z_][\w-]*\s*\([\s\S]*?\)\s*$/gim;

/** Inline `/name(args)` calls with a simple (single-paren) argument list. */
const SLASH_TOOL_CALL_INLINE_PATTERN = /\/[a-zA-Z_][\w-]*\s*\([^)\n]*\)/g;

/** Fabricated `[Tool Execution: ...]`, `[Tool call: ...]`, `[Tool-result: ...]`, `[System: ...]` marker lines. */
const TOOL_MARKER_LINE_PATTERN = /^\s*\[\s*(?:tool(?:\s+execut\w*|\s+call\w*|\s+run\w*)?|tool-result|tool-result-text|system)\s*:?[^\]]*\]\s*$/gim;

const TOOL_CALL_OBJECT_PATTERN = /^\s*(?:call_plan_manager_[\w-]+|plan_manager\.[\w-]+)\s*\([\s\S]*?\)\s*;?\s*$/gim;
const TOOL_JSON_ACTION_PATTERN = /^\s*\{\s*"action"\s*:\s*"(?:getPlan|getRange|addTask|bulkAddTasks|removeTask|bulkRemoveTasks|setDayMode|editTask|markDone|bulkMarkDone|getAllTasks|getTaskBank|editAnyTask|deleteAnyTask|createBlock|deleteBlock|activateBlock|editBlock|listBlocks|extendBlock|listPlanners|getSubject|getPlanner|getTest|getTests|getRoutine|getContext|websearch)"[\s\S]*?\}\s*,?\s*$/gim;
const TOOL_JSON_BATCH_PATTERN = /^\s*\{\s*"actions"\s*:\s*\[[\s\S]*?\]\s*\}\s*,?\s*$/gim;

/** Known tool names used by the JSON/python call strippers below. */
const TOOL_NAME_ALT = '(?:getPlan|getRange|getAllTasks|getTaskBank|addTask|bulkAddTasks|removeTask|bulkRemoveTasks|setDayMode|editTask|markDone|bulkMarkDone|editAnyTask|deleteAnyTask|createBlock|deleteBlock|activateBlock|editBlock|listBlocks|extendBlock|listPlanners|getSubject|getPlanner|getTest|getTests|getRoutine|getContext)';

/** Inline `print(tool(args))` and bare `tool(args)` calls models echo as Python. */
const PYTHON_PRINT_CALL_PATTERN = new RegExp(`print\\s*\\(\\s*${TOOL_NAME_ALT}\\s*\\([^\\n]*?\\)\\s*\\)`, 'g');
const BARE_TOOL_CALL_INLINE_PATTERN = new RegExp(`${TOOL_NAME_ALT}\\s*\\([^\\n]*?\\)`, 'g');
/** Whole-line `print(removeTask(...))` / `removeTask(...)` calls (may span lines). */
const PYTHON_TOOL_CALL_LINE_PATTERN = new RegExp(`^\\s*(?:print\\s*\\(\\s*)?${TOOL_NAME_ALT}\\s*\\([^\\n]*\\)\\s*\\)?\\s*$`, 'gim');
/** Fenced code blocks (```python ... ```) that echo tool calls — dropped whole. */
const TOOL_CODE_FENCE_PATTERN = /```[a-zA-Z0-9_-]*\s*\n[\s\S]*?```/g;

/** Matches raw LLM control/special tokens (BOS, EOS, turns, headers, system tags, etc.). */
const CONTROL_TOKEN_PATTERN = /<\s*\|?\s*(?:begin|end|start|stop|eot|pad|unk|mask|thought|turn|user|model|assistant|system|tool|header)[_a-zA-Z0-9\s|_-]*\s*\|?\s*>|<\/?(?:s|s_turn|start_of_turn|end_of_turn|pad|unk|mask|tool_call|tool_response|context|thought|im_start|im_end|INST|SYS)>/gi;

/** Matches ChatML style role prefixes: `<|im_start|>assistant` / `<|start_header_id|>assistant<|end_header_id|>` */
const CHATML_ROLE_PATTERN = /<\s*\|\s*im_start\s*\|\s*>\s*(?:assistant|model|user|system)?\s*\n?/gi;
const LLAMA_HEADER_PATTERN = /<\s*\|\s*start_header_id\s*\|\s*>[\s\S]*?<\s*\|\s*end_header_id\s*\|\s*>\s*\n?/gi;

/** Matches specific token strings like `< | begin__of__sentence | >` or `<|begin_of_sentence|>` with flexible spacing/underscores. */
const RAW_BEGIN_TOKEN_PATTERN = /<\s*\|\s*begin(?:_{1,2}of_{1,2}sentence)?\s*\|\s*>/gi;
const BARE_CONTROL_WORD_PATTERN = /^\s*<(?:\s*\|\s*)?begin(?:_{1,2}of_{1,2}sentence)?(?:\s*\|\s*)?>\s*$/gim;

/**
 * Strips raw LLM control/tokenizer tokens (e.g. `<|begin_of_sentence|>`, `< | begin__of__sentence | >`).
 */
export function sanitizeControlTokens(text: string): string {
  if (!text) return '';
  return text
    .replace(CHATML_ROLE_PATTERN, '')
    .replace(LLAMA_HEADER_PATTERN, '')
    .replace(CONTROL_TOKEN_PATTERN, '')
    .replace(RAW_BEGIN_TOKEN_PATTERN, '')
    .replace(BARE_CONTROL_WORD_PATTERN, '')
    .replace(/<\s*\|\s*[\w\s_-]+\s*\|\s*>/g, '');
}

/**
 * Sanitizes a complete text: strips timestamps, control tokens, and raw tool-call traces.
 */
export function sanitizeAssistantLeaks(text: string): string {
  return sanitizeControlTokens(sanitizeToolLeaks(sanitizeTimestampLeaks(text)));
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
    .replace(SLASH_TOOL_CALL_INLINE_PATTERN, '')
    .replace(TOOL_CALL_OBJECT_PATTERN, '')
    .replace(TOOL_JSON_BATCH_PATTERN, '')
    .replace(TOOL_JSON_ACTION_PATTERN, '')
    // Code fences FIRST — before inline stripping removes the tool call that
    // lets us decide whether the whole fence is a tool-echo to drop.
    .replace(TOOL_CODE_FENCE_PATTERN, (block) =>
      new RegExp(`${TOOL_NAME_ALT}\\s*\\(|print\\s*\\(`).test(block) ? '' : block,
    )
    .replace(PYTHON_PRINT_CALL_PATTERN, '')
    .replace(BARE_TOOL_CALL_INLINE_PATTERN, '');
  return withoutCallObjects
    .split('\n')
    .filter(
      (line) =>
        !TOOL_TRACE_LINE_PATTERN.test(line) &&
        !SLASH_TOOL_CALL_LINE_PATTERN.test(line) &&
        !TOOL_MARKER_LINE_PATTERN.test(line) &&
        !PYTHON_TOOL_CALL_LINE_PATTERN.test(line),
    )
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
  // Growing partial of a known trace prefix (e.g. 'to' -> 'tool:', '[tool exec' -> '[tool execution:').
  const tracePrefixes = ['tool:', 'tool execution', 'tool call', 'tool-result', 'tool-result-text', '[system', 'call_plan_manager_', 'plan_manager.'];
  if (tracePrefixes.some((prefix) => prefix.startsWith(trimmed))) return true;
  // Any line that begins like a bracketed tool/system marker stays held until it
  // resolves into a strippable line or a newline ends it.
  const markerStarts = ['[tool ', '[tool:', '[tool-result', '[system'];
  if (markerStarts.some((prefix) => trimmed.startsWith(prefix))) return true;
  // Slash-style tool calls being typed, e.g. "/add_tasks(" or "/add".
  if (/^\/[a-z_][\w-]*\s*\(?\s*$/.test(trimmed)) return true;
  // Python-style tool calls being typed, e.g. "print(removeTask(" or "removeTask(".
  if (/^print\s*\(/.test(trimmed)) return true;
  if (new RegExp(`^${TOOL_NAME_ALT}\\s*\\(`).test(trimmed)) return true;
  return false;
}

export function createStreamSanitizer(): StreamSanitizer {
  let hold = '';
  return {
    push(delta: string): string {
      const combined = hold + delta;
      const stripped = sanitizeControlTokens(sanitizeToolLeaks(combined.replace(TIMESTAMP_PATTERN, '')));
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
