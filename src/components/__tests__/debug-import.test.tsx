import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import ChatMarkdown from '../ChatMarkdown';

function body(children: string) {
  return h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    children,
  });
}

describe('debug import side effect', () => {
  it('plain RMD after importing ChatMarkdown', () => {
    void ChatMarkdown;
    expect(renderToStaticMarkup(body('# a\n\nbody\n'))).toBeTruthy();
  });
  it('plain RMD again', () => {
    expect(renderToStaticMarkup(body('# a\n\nbody\n'))).toBeTruthy();
  });
  it('ChatMarkdown render', () => {
    expect(renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' }))).toBeTruthy();
  });
  it('plain RMD after ChatMarkdown render', () => {
    expect(renderToStaticMarkup(body('# a\n\nbody\n'))).toBeTruthy();
  });
});
