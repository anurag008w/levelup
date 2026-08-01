import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

function dumpPlugin() {
  return (tree: any) => {
    console.log('TREE', JSON.stringify(tree).slice(0, 1500));
  };
}

describe('debug tree', () => {
  it('dumps tree with remark-math', () => {
    expect(renderToStaticMarkup(
      h(ReactMarkdown, {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [[dumpPlugin]],
        children: '# a\n\nInline x^2\n',
      }),
    )).toBeTruthy();
  });
});
