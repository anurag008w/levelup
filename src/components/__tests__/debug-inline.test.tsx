import { Component, type ReactNode } from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';

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
function CopyButton(_props: { text: string }) {
  return h('button', { className: 'codeblock-copy' }, 'copy');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const components: any = {
  p: ({ node: _n, ...props }: any) => h('p', { className: 'md-p', ...props }),
  h1: ({ node: _n, ...props }: any) => h('h1', { className: 'md-h1', ...props }),
  code: ({ node: _n, className, children, ...props }: any) => h('code', { className: ['md-code', className].filter(Boolean).join(' '), ...props }, children),
  pre: ({ node, children }: any) => {
    const { lang, raw } = codeInfo(node as MdNode | undefined);
    return h('div', { className: 'codeblock' }, h('div', { className: 'codeblock-head' }, h('span', { className: 'codeblock-lang' }, lang || 'code'), h(CopyButton, { text: raw })), h('pre', { className: 'md-pre' }, children));
  },
};
class MdBoundary extends Component<{ text: string; children?: ReactNode }> {
  state = { failed: false, lastText: '' };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return h('pre', { className: 'md-fallback' }, this.props.text);
    return this.props.children;
  }
}
function Body({ text }: { text: string }) {
  return h(MdBoundary, { text }, h('div', { className: 'md' }, h(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
    ],
    components,
    children: text,
  })));
}
describe('debug inline', () => {
  it('render 1', () => { expect(renderToStaticMarkup(h(Body, { text: 'plain' }))).toBeTruthy(); });
  it('render 2', () => { expect(renderToStaticMarkup(h(Body, { text: '# a\n\nbody\n' }))).toBeTruthy(); });
});
