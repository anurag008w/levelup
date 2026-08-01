import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const common: any = {
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [
    [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
  ],
};

describe('debug bisect', () => {
  it('react-markdown no options', () => {
    const result = renderToStaticMarkup(h(ReactMarkdown, { children: 'plain' }));
    expect(result).toBeTruthy();
  });
  it('react-markdown with highlight', () => {
    const result = renderToStaticMarkup(h(ReactMarkdown, { ...common, children: 'plain' }));
    expect(result).toBeTruthy();
  });
  it('react-markdown katex opts via variable spread', () => {
    const result = renderToStaticMarkup(h(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [[rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }]], children: 'plain' }));
    expect(result).toBeTruthy();
  });
  it('react-markdown with lucide import', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('lucide-react');
    const result = renderToStaticMarkup(h(ReactMarkdown, { ...common, children: 'plain' }));
    expect(result).toBeTruthy();
  });
});
