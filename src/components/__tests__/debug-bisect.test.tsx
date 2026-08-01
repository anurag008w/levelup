import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';

const common = {
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [
    [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
    [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
  ],
};

describe('debug bisect', () => {
  it('react-markdown no options', () => {
    try { renderToStaticMarkup(h(ReactMarkdown, { children: 'plain' })); console.log('OK noopts'); }
    catch (e) { console.log('FAIL noopts ->', (e as Error).message); }
  });
  it('react-markdown katex options', () => {
    try { renderToStaticMarkup(h(ReactMarkdown, { ...common, children: 'plain' })); console.log('OK katexopts'); }
    catch (e) { console.log('FAIL katexopts ->', (e as Error).message); }
  });
  it('react-markdown katex opts via variable spread', () => {
    const opts = { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' } as const;
    try { renderToStaticMarkup(h(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [[rehypeKatex, opts], [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }]], children: 'plain' })); console.log('OK literalopts'); }
    catch (e) { console.log('FAIL literalopts ->', (e as Error).message); }
  });
  it('react-markdown with lucide import', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('lucide-react');
    try { renderToStaticMarkup(h(ReactMarkdown, { ...common, children: 'plain' })); console.log('OK lucide'); }
    catch (e) { console.log('FAIL lucide ->', (e as Error).message); }
  });
});
