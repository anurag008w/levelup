import { Component, useState, type ReactNode } from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';

interface MdNode { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: MdNode[]; }
function hastToText(node: MdNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'raw') return node.value ?? '';
  return (node.children ?? []).map(hastToText).join('');
}
function codeInfo(node: MdNode | undefined): { lang: string; raw: string } {
  const code = (node?.children ?? []).find((c) => c?.tagName === 'code');
  const classes = code?.properties?.className;
  const cls = Array.isArray(classes) ? classes.join(' ') : String(classes ?? '');
  const lang = /language-([\w-]+)/.exec(cls)?.[1] ?? 'text';
  return { lang, raw: hastToText(code ?? node) };
}
function CopyButton({ text }: { text: string }) {
  const [copied] = useState(false);
  return h('button', { className: 'codeblock-copy' }, copied ? 'copied' : `copy ${text.length}`);
}
const components: Components = {
  p: ({ node: _n, ...props }) => h('p', { className: 'md-p', ...props }),
  h1: ({ node: _n, ...props }) => h('h1', { className: 'md-h1', ...props }),
  code: ({ node: _n, className, children, ...props }) => h('code', { className: ['md-code', className].filter(Boolean).join(' '), ...props }, children),
  pre: ({ node, children }) => {
    const { lang, raw } = codeInfo(node as MdNode | undefined);
    return h('div', { className: 'codeblock' }, h('div', { className: 'codeblock-head' }, h('span', { className: 'codeblock-lang' }, lang || 'code'), h(CopyButton, { text: raw })), h('pre', { className: 'md-pre' }, children));
  },
};
class MdBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean; lastText: string }> {
  state = { failed: false, lastText: '' };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { text: string }, state: { failed: boolean; lastText: string }) {
    if (state.lastText !== props.text) return { failed: false, lastText: props.text };
    return null;
  }
  render() { return this.state.failed ? h('pre', { className: 'md-fallback' }, this.props.text) : this.props.children; }
}
function Chat({ text }: { text: string }) {
  return h(MdBoundary, { text }, h('div', { className: 'md' }, h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    components,
    children: text,
  })));
}
describe('debug inline chat', () => {
  it('render 1', () => { renderToStaticMarkup(h(Chat, { text: 'plain' })); console.log('OK1'); });
  it('render 2', () => { renderToStaticMarkup(h(Chat, { text: '# a\n\nbody\n' })); console.log('OK2'); });
  it('render 3', () => { renderToStaticMarkup(h(Chat, { text: '```js\nconst x = 1;\n```\n' })); console.log('OK3'); });
});
