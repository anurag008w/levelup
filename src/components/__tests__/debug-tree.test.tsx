import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

function dumpPlugin() {
  return (tree: any) => {
    console.log('TREE', JSON.stringify(tree).slice(0, 1500));
    for (let i = 0; i < 3; i++) {
      if (tree.children?.[i]) console.log(`child[${i}]`, JSON.stringify(tree.children[i]).slice(0, 300));
    }
  };
}

describe('debug tree', () => {
  it('dumps tree with remark-math', () => {
    try {
      renderToStaticMarkup(
        h(ReactMarkdown, {
          remarkPlugins: [remarkGfm, remarkMath],
          rehypePlugins: [[dumpPlugin], [rehypeKatex, {}]],
          children: '# a\n\nInline \\(x^2\\)\n',
        }),
      );
      console.log('OK');
    } catch (e) {
      console.log('FAIL', (e as Error).message);
    }
  });
});
