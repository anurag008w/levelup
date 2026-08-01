import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import ChatMarkdown from '../ChatMarkdown';
import { unwrapMarkdownFence } from '../markdown-utils';

function body(children: string) {
  return h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    children,
  });
}

describe('debug init variants', () => {
  it('init with processed var', () => {
    const processed = unwrapMarkdownFence('plain');
    expect(renderToStaticMarkup(h('div', { className: 'md' }, body(processed)))).toBeTruthy();
  });
  it('ChatMarkdown plain', () => { expect(renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' }))).toBeTruthy(); });
  it('ChatMarkdown plain2', () => { expect(renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' }))).toBeTruthy(); });
});
