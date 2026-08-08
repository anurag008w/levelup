/**
 * Shared import-text cleanup for every user-facing JSON import path
 * (planner upload, backup restore, chat transcript import, curriculum import).
 *
 * Users copy from external AIs and file pickers, so the raw text frequently
 * carries noise that is NOT part of the JSON spec but should never fail an
 * otherwise-valid payload:
 *  - UTF-8 BOM ("\uFEFF") — FileReader/file pickers often prepend it.
 *  - Markdown code fences ("```json ... ```") — ChatGPT/Claude/Gemini wrap
 *    their JSON answer in fences by default.
 *  - Leading/trailing whitespace and blank lines.
 *
 * Returns the cleaned string; when no fence wrapper is present the input is
 * returned trimmed (BOM stripped) unchanged, so inline/partial JSON still
 * reaches JSON.parse exactly as before.
 */
export function cleanImportText(text: string): string {
  if (typeof text !== 'string') return '';
  let raw = text.replace(/^\uFEFF/, '').trim();
  // Strip a single ```json / ``` markdown fence wrapper if present.
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) raw = fence[1].trim();
  return raw;
}
