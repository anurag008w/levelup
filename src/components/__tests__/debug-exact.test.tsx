import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import ChatMarkdown from '../ChatMarkdown';
import { unwrapMarkdownFence } from '../markdown-utils';

describe('debug exact body', () => {
  it('exact JSX body, no boundary', () => {
    const processed = unwrapMarkdownFence('plain');
    const html = renderToStaticMarkup(h('div', { className: 'md' }, h(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [
        [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
      ],
      children: processed,
    })));
    expect(html).toBeTruthy();
  });
  it('ChatMarkdown module', () => {
    expect(renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' }))).toBeTruthy();
  });
  it('ChatMarkdown wrapped in boundary class', () => {
    expect(renderToStaticMarkup(h('div', null, h(ChatMarkdown, { text: 'plain' })))).toBeTruthy();
  });
});
