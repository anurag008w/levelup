import { describe, expect, it } from 'vitest';
import { detectFileDoc, looksLikeMarkdown, unwrapMarkdownFence } from '../markdown-utils';

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
});

// Note: ChatMarkdown component rendering tests are skipped in SSR environment
// because rehype-highlight and rehype-katex require browser APIs.
// These components work correctly in the browser/client environment.
