import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from '../ChatMarkdown';
import { unwrapMarkdownFence } from '../markdown-utils';

describe('debug utils-import theory', () => {
  it('render 1', () => { void unwrapMarkdownFence; renderToStaticMarkup(h(ChatMarkdown, { text: '# a\n\nbody\n' })); console.log('OK1'); });
  it('render 2', () => { renderToStaticMarkup(h(ChatMarkdown, { text: '# b\n\nbody\n' })); console.log('OK2'); });
});
