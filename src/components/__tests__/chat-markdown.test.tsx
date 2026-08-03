import { describe, expect, it } from 'vitest';
import { detectFileDoc, looksLikeMarkdown, normalizeLatexDelimiters, unwrapMarkdownFence } from '../markdown-utils';

describe('markdown-utils', () => {
  it('looksLikeMarkdown detects headings, lists, tables and math', () => {
    expect(looksLikeMarkdown('# heading')).toBe(true);
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('| a | b |')).toBe(true);
    expect(looksLikeMarkdown('$$x^2$$')).toBe(true);
    expect(looksLikeMarkdown('plain text only')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
  });

  it('unwrapMarkdownFence strips wrapping fences only', () => {
    expect(unwrapMarkdownFence('```md\n# Hi\n```')).toBe('# Hi');
    expect(unwrapMarkdownFence('```markdown\n# Hi\n```\n')).toBe('# Hi');
    expect(unwrapMarkdownFence('```python\nx=1\n```')).toBe('```python\nx=1\n```');
    expect(unwrapMarkdownFence('no fence')).toBe('no fence');
  });

  it('detectFileDoc flags structured documents only', () => {
    const doc = '# Formula Sheet\n\n## Trigonometry\n\nsin^2 + cos^2 = 1\nsin^2 + cos^2 = 1\nsin^2 + cos^2 = 1\n\n## Calculus\n\nderivative formulas\n\n';
    const card = detectFileDoc(doc);
    expect(card).not.toBeNull();
    expect(card?.name).toBe('formula-sheet.md');

    expect(detectFileDoc('too short')).toBeNull();
    expect(detectFileDoc('# One heading\n\nonly one section')).toBeNull();
    expect(detectFileDoc('no heading at all, just a long chat reply that goes on for a while and repeats itself many times to be longer than one hundred twenty characters')).toBeNull();
  });

  it('normalizeLatexDelimiters converts \\(...\\) and \\[...\\] to $...$/$$...$$ so remark-math can parse them', () => {
    expect(normalizeLatexDelimiters('Solve \\(x^2 + 1\\) here')).toBe('Solve $x^2 + 1$ here');
    expect(normalizeLatexDelimiters('\\[\\int_0^1 x\\,dx\\]')).toBe('$$\\int_0^1 x\\,dx$$');
    expect(normalizeLatexDelimiters('plain text, no math')).toBe('plain text, no math');
    // Leaves code fences / inline code untouched even if they contain literal \( \)
    expect(normalizeLatexDelimiters('`\\(not math\\)`')).toBe('`\\(not math\\)`');
    expect(normalizeLatexDelimiters('```\\(also not math\\)```')).toBe('```\\(also not math\\)```');
    // Unclosed delimiters (mid-stream) are left as-is rather than corrupted
    expect(normalizeLatexDelimiters('\\(unclosed')).toBe('\\(unclosed');
  });
});

// Note: ChatMarkdown component rendering tests are skipped in SSR environment
// because rehype-highlight and rehype-katex require browser APIs.
// These components work correctly in the browser/client environment.
