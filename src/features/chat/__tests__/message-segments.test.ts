import { describe, expect, it } from 'vitest';
import {
  BUBBLE_GAP_MIN_MS,
  BUBBLE_GAP_RANDOM_MS,
  FIRST_BUBBLE_DELAY_MS,
  buildNotificationSteps,
  computeRevealSchedule,
  splitReplyIntoBubbles,
  totalRevealDelay,
} from '../message-segments';

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

  it('drops a standalone horizontal-rule paragraph instead of giving it its own bubble', () => {
    const text = ['Step 1: karo yeh.', '', '---', '', 'Step 2: fir yeh karo.', '', '***', '', 'Step 3: aakhri step.'].join('\n');
    expect(splitReplyIntoBubbles(text)).toEqual(['Step 1: karo yeh.', 'Step 2: fir yeh karo.', 'Step 3: aakhri step.']);
  });

  it('returns an empty array for empty or whitespace-only text', () => {
    expect(splitReplyIntoBubbles('')).toEqual([]);
    expect(splitReplyIntoBubbles('   \n\n  ')).toEqual([]);
  });
});

describe('computeRevealSchedule', () => {
  it('gives a single bubble just the fixed first-pause delay and no gaps', () => {
    const schedule = computeRevealSchedule(1);
    expect(schedule.firstDelay).toBe(FIRST_BUBBLE_DELAY_MS);
    expect(schedule.gapDelays).toEqual([]);
  });

  it('keeps a zero-bubble reply (no visible content) with no gaps', () => {
    const schedule = computeRevealSchedule(0);
    expect(schedule.firstDelay).toBe(FIRST_BUBBLE_DELAY_MS);
    expect(schedule.gapDelays).toEqual([]);
  });

  it('adds one gap delay per paragraph after the first', () => {
    const schedule = computeRevealSchedule(4);
    expect(schedule.gapDelays).toHaveLength(3);
  });

  it('uses the injectable rng for the random between-paragraph pauses', () => {
    const rng = () => 0.5;
    const schedule = computeRevealSchedule(3, rng);
    expect(schedule.gapDelays).toEqual([BUBBLE_GAP_MIN_MS + 0.5 * BUBBLE_GAP_RANDOM_MS, BUBBLE_GAP_MIN_MS + 0.5 * BUBBLE_GAP_RANDOM_MS]);
  });

  it('keeps every gap within the documented 3-8s range', () => {
    const rng = () => Math.random();
    const schedule = computeRevealSchedule(10, rng);
    for (const gap of schedule.gapDelays) {
      expect(gap).toBeGreaterThanOrEqual(BUBBLE_GAP_MIN_MS);
      expect(gap).toBeLessThanOrEqual(BUBBLE_GAP_MIN_MS + BUBBLE_GAP_RANDOM_MS);
    }
  });
});

describe('totalRevealDelay', () => {
  it('is just the first delay when there are no gaps', () => {
    const schedule = computeRevealSchedule(1);
    expect(totalRevealDelay(schedule)).toBe(FIRST_BUBBLE_DELAY_MS);
  });

  it('sums the first delay and every between-paragraph gap', () => {
    const schedule = computeRevealSchedule(5, () => 0);
    expect(totalRevealDelay(schedule)).toBe(
      FIRST_BUBBLE_DELAY_MS + (5 - 1) * BUBBLE_GAP_MIN_MS,
    );
  });
});

describe('buildNotificationSteps', () => {
  it('fires one step per bubble at its reveal moment', () => {
    const schedule = computeRevealSchedule(3, () => 0);
    const steps = buildNotificationSteps(['P1', 'P2', 'P3'], schedule);
    expect(steps).toHaveLength(3);
    expect(steps[0].delayMs).toBe(FIRST_BUBBLE_DELAY_MS);
    expect(steps[1].delayMs).toBe(FIRST_BUBBLE_DELAY_MS + BUBBLE_GAP_MIN_MS);
    expect(steps[2].delayMs).toBe(FIRST_BUBBLE_DELAY_MS + 2 * BUBBLE_GAP_MIN_MS);
  });

  it('merges content so far into every step, ending with the full reply', () => {
    const schedule = computeRevealSchedule(3, () => 0);
    const steps = buildNotificationSteps(['Pehla', 'Dusra', 'Teen'], schedule);
    expect(steps[0].text).toBe('Pehla');
    expect(steps[1].text).toBe('Pehla\n\nDusra');
    expect(steps[2].text).toBe('Pehla\n\nDusra\n\nTeen');
  });

  it('marks the newest bubble as `latest` (collapsed body) on every step', () => {
    const schedule = computeRevealSchedule(3, () => 0);
    const steps = buildNotificationSteps(['Pehla', 'Dusra', 'Teen'], schedule);
    expect(steps[0].latest).toBe('Pehla');
    expect(steps[1].latest).toBe('Dusra');
    expect(steps[2].latest).toBe('Teen');
  });

  it('builds the conversation (`messages`) with real reveal timestamps for native MessagingStyle', () => {
    const now = 1_700_000_000_000;
    const schedule = computeRevealSchedule(2, () => 0);
    const steps = buildNotificationSteps(['Pehla', 'Dusra'], schedule, now);
    expect(steps[0].messages).toEqual([{ text: 'Pehla', at: now + FIRST_BUBBLE_DELAY_MS }]);
    expect(steps[1].messages).toEqual([
      { text: 'Pehla', at: now + FIRST_BUBBLE_DELAY_MS },
      { text: 'Dusra', at: now + FIRST_BUBBLE_DELAY_MS + BUBBLE_GAP_MIN_MS },
    ]);
  });

  it('returns a single step for a one-bubble reply', () => {
    const schedule = computeRevealSchedule(1);
    const steps = buildNotificationSteps(['Ek hi paragraph'], schedule);
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe('Ek hi paragraph');
    expect(steps[0].delayMs).toBe(FIRST_BUBBLE_DELAY_MS);
  });

  it('returns no steps for an empty bubble list', () => {
    const schedule = computeRevealSchedule(0);
    expect(buildNotificationSteps([], schedule)).toEqual([]);
  });

  it('trims surrounding whitespace from merged text', () => {
    const schedule = computeRevealSchedule(2, () => 0);
    const steps = buildNotificationSteps(['  pehla  ', '  dusra  '], schedule);
    expect(steps[0].text).toBe('pehla');
    expect(steps[0].latest).toBe('pehla');
    expect(steps[1].text).toBe('pehla\n\ndusra');
    expect(steps[1].latest).toBe('dusra');
  });
});
