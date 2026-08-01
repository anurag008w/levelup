import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';

function Body({ text }: { text: string }) {
  return h(
    'div',
    { className: 'md' },
    h(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [[rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }]],
      children: text,
    }),
  );
}

describe('debug boundary', () => {
  it('render 1', () => { expect(renderToStaticMarkup(h(Body, { text: 'plain' }))).toBeTruthy(); });
  it('render 2', () => { expect(renderToStaticMarkup(h(Body, { text: '# a\n\nbody\n' }))).toBeTruthy(); });
  it('render 3', () => { expect(renderToStaticMarkup(h(Body, { text: 'plain' }))).toBeTruthy(); });
});
