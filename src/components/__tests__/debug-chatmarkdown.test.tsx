import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import 'katex/dist/katex.min.css';
import ChatMarkdown from '../ChatMarkdown';

describe('debug ChatMarkdown', () => {
  it('renders plain', () => {
    const html = renderToStaticMarkup(h(ChatMarkdown, { text: 'plain' }));
    console.log('PLAIN OK', html.slice(0, 80));
  });
  it('renders heading', () => {
    const html = renderToStaticMarkup(h(ChatMarkdown, { text: '# Title\n\nbody\n' }));
    console.log('HEADING OK', html.slice(0, 120));
  });
});
