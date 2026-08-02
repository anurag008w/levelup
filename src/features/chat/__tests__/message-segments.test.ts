import { describe, expect, it } from 'vitest';
import { splitReplyIntoBubbles } from '../message-segments';

describe('splitReplyIntoBubbles', () => {
  it('splits a reply into one bubble per paragraph break', () => {
    const text = [
      'Hey! Misa here. Time dekho, 11 baj chuke hain.',
      '',
      'Chalo, apna mock test start karo.',
      '',
      'Physics, Chemistry, aur Maths solve karna hai.',
    ].join('\n');
    expect(splitReplyIntoBubbles(text)).toEqual([
      'Hey! Misa here. Time dekho, 11 baj chuke hain.',
      'Chalo, apna mock test start karo.',
      'Physics, Chemistry, aur Maths solve karna hai.',
    ]);
  });

  it('keeps tight single-newline lines (lists/tables) together in one bubble', () => {
    const table = ['| Topic | Done |', '| --- | --- |', '| Rotational | ✓ |', '| Electrostatics | ✗ |'].join('\n');
    expect(splitReplyIntoBubbles(table)).toEqual([table]);
  });

  it('keeps a fenced code block whole even with blank lines inside', () => {
    const code = '```python\n\ndef solve():\n\n    return 42\n\n```';
    expect(splitReplyIntoBubbles(code)).toEqual([code]);
  });

  it('splits paragraphs around a fenced code block', () => {
    const text = ['Pehla paragraph.', '', '```js\nconst a = 1;\n\nconst b = 2;\n```', '', 'Aakhri paragraph.'].join('\n');
    expect(splitReplyIntoBubbles(text)).toEqual([
      'Pehla paragraph.',
      '```js\nconst a = 1;\n\nconst b = 2;\n```',
      'Aakhri paragraph.',
    ]);
  });

  it('keeps a single paragraph as one bubble no matter how long', () => {
    const text = 'Itna lamba reply ek hi paragraph mein ho aur koi paragraph break na ho toh yeh ek hi bubble rehna chahiye. '.repeat(30);
    const result = splitReplyIntoBubbles(text);
    expect(result).toEqual([text.trim()]);
  });

  it('trims whitespace and drops empty parts', () => {
    const text = '\n\n  Hello world  \n\n\n  Second part  \n\n';
    expect(splitReplyIntoBubbles(text)).toEqual(['Hello world', 'Second part']);
  });

  it('handles CRLF line endings', () => {
    const text = 'Part one\r\n\r\nPart two';
    expect(splitReplyIntoBubbles(text)).toEqual(['Part one', 'Part two']);
  });

  it('returns an empty array for empty or whitespace-only text', () => {
    expect(splitReplyIntoBubbles('')).toEqual([]);
    expect(splitReplyIntoBubbles('   \n\n  ')).toEqual([]);
  });
});
