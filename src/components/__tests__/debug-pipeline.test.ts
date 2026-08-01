import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

describe('debug pipeline in vitest', () => {
  it('raw unified pipeline', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const unified = require('unified');
    const remarkParse = require('remark-parse').default;
    const remarkRehype = require('remark-rehype').default;
    const p = unified.unified()
      .use(remarkParse)
      .use([remarkGfm, remarkMath])
      .use(remarkRehype, { allowDangerousHtml: true })
      .use([[rehypeKatex, {}], [rehypeHighlight, {}]]);
    p.runSync(p.parse('plain'));
    console.log('unified OK');
  });

  it('react-markdown direct', () => {
    const html = renderToStaticMarkup(h(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      children: 'plain',
    }));
    console.log('rmd OK', html.slice(0, 60));
  });

  it('react-markdown with katex+highlight', () => {
    const html = renderToStaticMarkup(h(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [
        [rehypeKatex, { output: 'html', strict: false, trust: false, maxSize: 10, errorColor: '#f25d68' }],
        [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
      ],
      children: '# Title\n\nInline \\(e^{i\\pi}\\)\n',
    }));
    console.log('rmd+katex OK', html.slice(0, 60));
  });
});
