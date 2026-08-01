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
  pre: ({ node: _node, children }: { node?: unknown; children?: unknown }) => h('pre', null, children),
  p: (props: { children?: unknown }) => h('p', { className: 'md-p' }, props.children),
  h1: (props: { children?: unknown }) => h('h1', { className: 'md-h1' }, props.children),
};

function body(children: string) {
  return h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    components,
    children,
  });
}

describe('debug components', () => {
  it('render 1', () => { renderToStaticMarkup(body('# a\n\nbody\n')); console.log('OK1'); });
  it('render 2', () => { renderToStaticMarkup(body('# a\n\nbody\n')); console.log('OK2'); });
  it('render 3', () => { renderToStaticMarkup(body('# a\n\nbody\n')); console.log('OK3'); });
});
