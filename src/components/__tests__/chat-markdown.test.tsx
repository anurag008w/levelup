import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from '../ChatMarkdown';
import { detectFileDoc, looksLikeMarkdown, unwrapMarkdownFence } from '../markdown-utils';

function render(md: string): string {
  return renderToStaticMarkup(h(ChatMarkdown, { text: md }));
}

describe('ChatMarkdown', () => {
  it('renders headings, emphasis, lists, quote and rules', () => {
    const html = render('# Title\n\n**bold** and *italic* and ~~strike~~\n\n> quote\n\n- a\n- b\n\n1. one\n2. two\n\n---\n');
    expect(html).toContain('md-h1');
    expect(html).toContain('md-strong');
    expect(html).toContain('md-em');
    expect(html).toContain('md-del');
    expect(html).toContain('md-quote');
    expect(html).toContain('md-ul');
    expect(html).toContain('md-ol');
    expect(html).toContain('md-hr');
  });

  it('renders GFM tables inside a scrollable wrapper', () => {
    const html = render('| A | B |\n| - | - |\n| 1 | 2 |\n');
    expect(html).toContain('md-table-wrap');
    expect(html).toContain('md-table');
    expect(html).toContain('md-th');
    expect(html).toContain('md-td');
  });

  it('renders GFM task list checkboxes', () => {
    const html = render('- [x] done\n- [ ] pending\n');
    expect(html).toContain('md-task-check');
    expect(html).toContain('checked');
  });

  it('renders KaTeX inline and display math', () => {
    const html = render('Inline \\(e^{i\\pi}+1=0\\) and display:\n\n\\[\\int_0^1 x^2\\,dx\\]\n');
    expect(html).toContain('katex');
  });

  it('renders fenced code with language label and copy button', () => {
    const html = render('```js\nconst x = 1;\n```\n');
    expect(html).toContain('codeblock');
    expect(html).toContain('codeblock-lang');
    expect(html).toContain('codeblock-copy');
    expect(html).toContain('const x = 1;');
  });

  it('applies highlight.js classes to known languages', () => {
    const html = render('```python\ndef f():\n    return 1\n```\n');
    expect(html).toContain('hljs-keyword');
  });

  it('unwraps a single wrapping markdown fence', () => {
    const html = render('```markdown\n# Doc\n\nSome body.\n```\n');
    expect(html).toContain('md-h1');
    expect(html).not.toContain('md-pre');
  });

  it('does not throw on unclosed math mid-stream', () => {
    const html = render('Partial \\( \\frac{1}{2');
    expect(html.length).toBeGreaterThan(0);
  });

  it('falls back to plain text when no markdown syntax is present', () => {
    const html = render('just a normal sentence with no markup');
    expect(html).not.toContain('md-h1');
    expect(html).toContain('just a normal sentence with no markup');
  });
});

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
    const doc = '# Formula Sheet\n\n## Trigonometry\n\nsin^2 + cos^2 = 1\n\n## Calculus\n\nderivative\n';
    const card = detectFileDoc(doc);
    expect(card).not.toBeNull();
    expect(card?.name).toBe('formula-sheet.md');

    expect(detectFileDoc('too short')).toBeNull();
    expect(detectFileDoc('# One heading\n\nonly one section')).toBeNull();
    expect(detectFileDoc('no heading at all, just a long chat reply that goes on for a while and repeats itself many times to be longer than one hundred twenty characters')).toBeNull();
  });
});
