import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';

const components = {
  pre: ({ node, children }: any) => {
    void node;
    return h('pre', null, children);
  },
  p: (props: any) => h('p', { className: 'md-p' }, props.children),
};

describe('debug components trigger', () => {
  it('with components prop', () => {
    const result = renderToStaticMarkup(h(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [
        [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'md', 'markdown', 'log'] }],
      ],
      components,
      children: 'plain',
    }));
    expect(result).toBeTruthy();
  });
});
