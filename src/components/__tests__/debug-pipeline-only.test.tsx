import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';

function body(children: string) {
  return h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    children,
  });
}

describe('debug pipeline only', () => {
  it('render 1', () => { expect(renderToStaticMarkup(body('# a\n\nbody\n'))).toBeTruthy(); });
  it('render 2', () => { expect(renderToStaticMarkup(body('# a\n\nbody\n'))).toBeTruthy(); });
  it('render 3', () => { expect(renderToStaticMarkup(body('# a\n\nbody\n'))).toBeTruthy(); });
});
