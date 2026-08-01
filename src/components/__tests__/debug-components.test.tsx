import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';

const components = {
  pre: ({ node, children }: any) => {
    void node;
    return h('pre', null, children);
  },
  p: (props: any) => h('p', { className: 'md-p' }, props.children),
};

describe('debug components trigger', () => {
  it('with components prop', () => {
    try {
      renderToStaticMarkup(h(ReactMarkdown, {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [
          [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
          [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
        ],
        components,
        children: 'plain',
      }));
      console.log('OK with components');
    } catch (e) {
      console.log('FAIL with components ->', (e as Error).message);
    }
  });
});
