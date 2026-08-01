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
import { unwrapMarkdownFence } from '../markdown-utils';

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

describe('debug init variants', () => {
  it('init with processed var', () => {
    const processed = unwrapMarkdownFence('plain');
    renderToStaticMarkup(h('div', { className: 'md' }, body(processed)));
    console.log('OK init processed');
  });
  it('ChatMarkdown plain', () => { renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' })); console.log('OK chat plain'); });
  it('ChatMarkdown plain2', () => { renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' })); console.log('OK chat plain2'); });
});
