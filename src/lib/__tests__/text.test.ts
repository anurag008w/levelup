import { describe, it, expect } from 'vitest';
import { truncateMeaningful } from '../text';

describe('truncateMeaningful', () => {
  it('returns short text unchanged', () => {
    expect(truncateMeaningful('hello world', 100)).toBe('hello world');
  });

  it('cuts at a word boundary instead of mid-word', () => {
    const text = 'Student ka target hai IIT Delhi crack karna aur Physics me improvement chahiye';
    const out = truncateMeaningful(text, 40);
    expect(out.length).toBeLessThanOrEqual(41);
    // The last kept token must be a whole word, never a slice like "cracki".
    expect(out.endsWith('…')).toBe(true);
    const trimmed = out.slice(0, -1).trimEnd();
    expect(trimmed.endsWith(' ')).toBe(false);
  });

  it('prefers a sentence boundary over a plain word boundary', () => {
    const text = 'Pehli baat: maths me 90 marks aaye. Doosri baat: physics weak hai aur roz 2 ghante chahiye.';
    const out = truncateMeaningful(text, 60);
    const trimmed = out.slice(0, -1).trimEnd();
    // Should back off to the first complete sentence, not split mid-sentence.
    expect(trimmed).toBe('Pehli baat: maths me 90 marks aaye.');
  });

  it('keeps the whole window when no boundary exists in range', () => {
    const out = truncateMeaningful('x'.repeat(1000), 50);
    expect(out).toBe(`${'x'.repeat(50)}…`);
  });

  it('never returns an empty string for non-empty input', () => {
    expect(truncateMeaningful('short but still cut', 5).length).toBeGreaterThan(0);
  });
});
