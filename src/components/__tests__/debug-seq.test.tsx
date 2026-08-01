import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import ChatMarkdown from '../ChatMarkdown';

const mk = (children: string) =>
  h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    children,
  });

describe('debug sequence', () => {
  it('plain RMD then plain RMD', () => {
    expect(renderToStaticMarkup(mk('# a\n\nbody\n'))).toBeTruthy();
    expect(renderToStaticMarkup(mk('# b\n\nbody\n'))).toBeTruthy();
  });
  it('ChatMarkdown then ChatMarkdown', () => {
    expect(renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' }))).toBeTruthy();
    expect(renderToStaticMarkup(h(ChatMarkdown, { text: '# b\n\nbody\n' }))).toBeTruthy();
  });
  it('plain RMD then ChatMarkdown', () => {
    expect(renderToStaticMarkup(mk('# a\n\nbody\n'))).toBeTruthy();
    expect(renderToStaticMarkup(h(ChatMarkdown, { text: '# b\n\nbody\n' }))).toBeTruthy();
  });
  it('ChatMarkdown then plain RMD', () => {
    expect(renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' }))).toBeTruthy();
    expect(renderToStaticMarkup(mk('# b\n\nbody\n'))).toBeTruthy();
  });
});
