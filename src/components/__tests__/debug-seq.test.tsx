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

const mk = (children: string) =>
  h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    children,
  });

describe('debug sequence', () => {
  it('plain RMD then plain RMD', () => {
    renderToStaticMarkup(mk('# a\n\nbody\n'));
    renderToStaticMarkup(mk('# b\n\nbody\n'));
    console.log('OK plain x2');
  });
  it('ChatMarkdown then ChatMarkdown', () => {
    renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' }));
    renderToStaticMarkup(h(ChatMarkdown, { text: '# b\n\nbody\n' }));
    console.log('OK ChatMarkdown x2');
  });
  it('plain RMD then ChatMarkdown', () => {
    renderToStaticMarkup(mk('# a\n\nbody\n'));
    renderToStaticMarkup(h(ChatMarkdown, { text: '# b\n\nbody\n' }));
    console.log('OK RMD then Chat');
  });
  it('ChatMarkdown then plain RMD', () => {
    renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' }));
    renderToStaticMarkup(mk('# b\n\nbody\n'));
    console.log('OK Chat then RMD');
  });
});
