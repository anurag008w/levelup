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

describe('debug exact body', () => {
  it('exact JSX body, no boundary', () => {
    const processed = unwrapMarkdownFence('plain');
    try {
      renderToStaticMarkup(h('div', { className: 'md' }, h(ReactMarkdown, {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [
          [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
          [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
        ],
        children: processed,
      })));
      console.log('OK exact body');
    } catch (e) {
      console.log('FAIL exact body ->', (e as Error).message);
    }
  });
  it('ChatMarkdown module', () => {
    try {
      renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' }));
      console.log('OK ChatMarkdown');
    } catch (e) {
      console.log('FAIL ChatMarkdown ->', (e as Error).message);
    }
  });
  it('ChatMarkdown wrapped in boundary class', () => {
    const html = renderToStaticMarkup(h('div', null, h(ChatMarkdown, { text: 'plain' })));
    console.log('wrapped OK', html.length);
  });
});
