import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from '../ChatMarkdown';

describe('debug loop', () => {
  it('renders ChatMarkdown 10 times', () => {
    for (let i = 0; i < 10; i++) {
      expect(renderToStaticMarkup(h(ChatMarkdown, { text: '# Heading ' + i + '\n\nbody ' + i + '\n' }))).toBeTruthy();
    }
  });
});
