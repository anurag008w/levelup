import { describe, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatMarkdown from '../ChatMarkdown';

describe('debug loop', () => {
  it('renders ChatMarkdown 10 times', () => {
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      try {
        renderToStaticMarkup(h(ChatMarkdown, { text: `# Heading ${i}\n\nbody ${i}\n` }));
        ok++;
      } catch (e) {
        console.log(`render ${i} FAILED ->`, (e as Error).stack?.split('\n').slice(0, 12).join('\n'));
      }
    }
    console.log(`ok=${ok}/10`);
  });
});
