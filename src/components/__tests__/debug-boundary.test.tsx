import { Component, createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';

class Boundary extends Component<{ text: string; children: ReactNode }, { failed: boolean; lastText: string }> {
  state = { failed: false, lastText: '' };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: { text: string }, state: { failed: boolean; lastText: string }) {
    if (state.lastText !== props.text) {
      return { failed: false, lastText: props.text };
    }
    return null;
  }
  render() {
    if (this.state.failed) return h('pre', { className: 'md-fallback' }, this.props.text);
    return this.props.children;
  }
}

function Body({ text }: { text: string }) {
  return h(
    Boundary,
    { text },
    h(
      'div',
      { className: 'md' },
      h(ReactMarkdown, {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [
          [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
          [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
        ],
        children: text,
      }),
    ),
  );
}

describe('debug boundary', () => {
  it('render 1', () => { renderToStaticMarkup(h(Body, { text: 'plain' })); console.log('OK1'); });
  it('render 2', () => { renderToStaticMarkup(h(Body, { text: '# a\n\nbody\n' })); console.log('OK2'); });
  it('render 3', () => { renderToStaticMarkup(h(Body, { text: 'plain' })); console.log('OK3'); });
});
