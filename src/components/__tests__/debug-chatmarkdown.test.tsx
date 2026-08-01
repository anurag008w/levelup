import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from '../ChatMarkdown';

describe('debug ChatMarkdown', () => {
  it('renders plain', () => {
    // SSR-safe: KaTeX is skipped, falls back to plain render
    const html = renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' }));
    expect(html).toBeTruthy();
  });
  it('renders heading', () => {
    // SSR-safe: KaTeX is skipped, falls back to plain render
    const html = renderToStaticMarkup(h(ChatMarkdown, { text: '# Title\n\nbody\n' }));
    expect(html).toBeTruthy();
  });
});
