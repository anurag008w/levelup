// Markdown detection + document helpers shared by the chat renderers.

const MARKDOWN_HINTS: RegExp[] = [
  /^\s{0,3}#{1,6}\s/m, // ATX heading
  /^\s{0,3}(?:[-*_])\s{0,3}(?:[-*_])\s{0,3}(?:[-*_])\s*$/m, // horizontal rule
  /\*\*[^*]+\*\*/m, // bold
  /__[^_]+__/m, // bold (underscore)
  /^\s{0,3}>\s/m, // blockquote
  /^\s{0,3}[-*+]\s/m, // bullet list
  /^\s{0,3}\d+\.\s/m, // ordered list
  /^\s{0,3}\|.*\|\s*$/m, // table row
  /^\s{0,3}```/m, // fenced code
  /`[^`\n]+`/, // inline code
  /\$\$[\s\S]*?\$\$/, // $$ display math
  /\\\[[\s\S]*?\\\]/, // \[ \] display math
  /\\\([\s\S]*?\\\)/, // \( \) inline math
  /\\begin\{(align|align\*|equation|equation\*|gather|matrix|pmatrix|cases)\}/, // LaTeX env
  /!\[[^\]]*\]\([^)]+\)/, // image
  /^\[[^\]]+\]:\s+\S+/m, // reference link definition
];

/** True when the text plausibly contains markdown/LaTeX that should be rendered. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  return MARKDOWN_HINTS.some((re) => re.test(text));
}

/**
 * Strips a single wrapping ```markdown / ```md fence so model output that
 * wraps a whole document in a fence renders as markdown instead of a raw code
 * block. Raw fences are never shown unless the user explicitly asked for them.
 */
export function unwrapMarkdownFence(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const m = /^```(?:markdown|md|mdx|text|txt)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(normalized);
  return m && m[1] ? m[1] : normalized;
}

export interface FileDocInfo {
  name: string;
  extension: string;
  sizeLabel: string;
}

/**
 * Detects when a message is a standalone generated document (formula sheet,
 * notes, solution walkthrough) rather than a short chat reply — the app then
 * shows a file card with Preview + Download instead of dumping raw content.
 */
export function detectFileDoc(text: string): FileDocInfo | null {
  const src = text.trim();
  if (src.length < 120) return null;
  if (!/^#{1,6}\s+/m.test(src)) return null;
  const sections = src.match(/^#{1,6}\s+/gm)?.length ?? 0;
  const hasTable = /^\s{0,3}\|.*\|\s*$/m.test(src);
  if (sections < 2 && !hasTable) return null;
  const firstHeading = /^#{1,6}\s+(.+)$/m.exec(src)?.[1] ?? '';
  const base = slugify(firstHeading) || 'document';
  return { name: `${base}.md`, extension: 'md', sizeLabel: formatDocSize(src.length) };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function formatDocSize(chars: number): string {
  if (chars < 1024) return `${chars} chars`;
  return `${(chars / 1024).toFixed(1)} KB`;
}
