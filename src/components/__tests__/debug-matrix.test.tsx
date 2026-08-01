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

describe('debug text matrix', () => {
  it('init plain RMD heading', () => { renderToStaticMarkup(body('# a\n\nbody\n')); console.log('OK init'); });
  it('ChatMarkdown plain', () => { renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' })); console.log('OK chat plain'); });
  it('ChatMarkdown heading', () => { renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' })); console.log('OK chat heading'); });
  it('ChatMarkdown plain again', () => { renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' })); console.log('OK chat plain2'); });
  it('ChatMarkdown heading again', () => { renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' })); console.log('OK chat heading2'); });
});
