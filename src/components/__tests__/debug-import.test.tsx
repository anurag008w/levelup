import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import ChatMarkdown from '../ChatMarkdown';

function body(children: string) {
  return h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    children,
  });
}

describe('debug import side effect', () => {
  it('plain RMD after importing ChatMarkdown', () => {
    void ChatMarkdown;
    renderToStaticMarkup(body('# a\n\nbody\n'));
    console.log('OK1 plain after import');
  });
  it('plain RMD again', () => {
    renderToStaticMarkup(body('# a\n\nbody\n'));
    console.log('OK2 plain');
  });
  it('ChatMarkdown render', () => {
    renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' }));
    console.log('OK3 ChatMarkdown');
  });
  it('plain RMD after ChatMarkdown render', () => {
    renderToStaticMarkup(body('# a\n\nbody\n'));
    console.log('OK4 plain after chat');
  });
});
