import { describe, it, expect } from 'vitest';
import {
  parseMemoryBlocks,
  MAX_BLOCK_LINES,
  shouldPinMemoryBlock,
  stripListMarker,
  MEMORY_SUMMARY_INSTRUCTIONS,
} from '../../../core/domain/memory-summary';

describe('parseMemoryBlocks', () => {
  it('parses JSON blocks', () => {
    const text = '{"blocks":[{"title":"Aim","lines":["Target IIT Delhi","Weak in Calculus"],"longTerm":true,"tags":["goal"]}]}';
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('Aim');
    expect(blocks[0].lines).toEqual(['Target IIT Delhi', 'Weak in Calculus']);
    expect(blocks[0].longTerm).toBe(true);
    expect(blocks[0].tags).toEqual(['goal']);
  });

  it('splits overflow lines into extra blocks instead of dropping them', () => {
    const text = '{"blocks":[{"lines":["1","2","3","4","5","6","7","8","9","10"],"longTerm":false,"tags":["maths"]}]}';
    const blocks = parseMemoryBlocks(text);
    // 10 points -> two compact blocks, NOT one truncated block.
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lines).toHaveLength(MAX_BLOCK_LINES);
    expect(blocks[1].lines).toEqual(['9', '10']);
    const allLines = blocks.flatMap((b) => b.lines);
    expect(allLines).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('preserves every point across many split blocks and inherits pin/tags', () => {
    const text = '{"blocks":[{"title":"Week 1","lines":["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v"],"longTerm":true,"tags":["goal"]}]}';
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(3);
    expect(blocks.flatMap((b) => b.lines)).toHaveLength(22);
    for (const b of blocks) {
      expect(b.longTerm).toBe(true);
      expect(b.tags).toEqual(['goal']);
    }
  });

  it('caps the total blocks per run so a runaway reply cannot balloon memory', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `point-${i}`);
    const text = JSON.stringify({ blocks: [{ lines, longTerm: false }] });
    const blocks = parseMemoryBlocks(text);
    expect(blocks.length).toBeLessThanOrEqual(50);
    // Still keeps far more than the old 30x8 hard cap (240).
    expect(blocks.flatMap((b) => b.lines).length).toBeGreaterThan(240);
  });

  it('skips empty blocks and non-object entries', () => {
    const text = '{"blocks":[{"lines":[]},{"lines":["only"],"longTerm":true},"junk",null]}';
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual(['only']);
  });

  it('extracts JSON wrapped in prose or fences', () => {
    const text = 'sure, here:\n```json\n{"blocks":[{"lines":["Hinglish point"],"longTerm":false,"tags":["maths"]}]}\n```';
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toEqual(['Hinglish point']);
  });

  it('falls back to plain text separated by ---- blocks (overflow auto-splits)', () => {
    const text = [
      'Week 1: Physics strong, Calculus weak',
      'Roz 2 ghante padhna hai',
      '----',
      'Target: IIT Delhi',
      'Mock mein 140 marks aaye',
      '----',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ].join('\n');
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].lines).toEqual(['Week 1: Physics strong, Calculus weak', 'Roz 2 ghante padhna hai']);
    expect(blocks[1].lines).toEqual(['Target: IIT Delhi', 'Mock mein 140 marks aaye']);
    // The 10-line plain block splits into two — no line dropped.
    expect(blocks[2].lines).toHaveLength(MAX_BLOCK_LINES);
    expect(blocks[3].lines).toEqual(['9', '10']);
    expect(blocks.flatMap((b) => b.lines)).toHaveLength(2 + 2 + 10);
  });

  it('returns an empty array for empty or invalid replies', () => {
    expect(parseMemoryBlocks('')).toEqual([]);
    expect(parseMemoryBlocks('   ')).toEqual([]);
    expect(parseMemoryBlocks('no blocks here at all')).toEqual([]);
    expect(parseMemoryBlocks('{"foo":"bar"}')).toEqual([]);
  });
});

describe('stripListMarker', () => {
  it('removes only markdown list markers, never leading digits of content', () => {
    expect(stripListMarker('- Roz 2 ghante padhna hai')).toBe('Roz 2 ghante padhna hai');
    expect(stripListMarker('* Physics weak hai')).toBe('Physics weak hai');
    expect(stripListMarker('1. Target IIT Delhi')).toBe('Target IIT Delhi');
    expect(stripListMarker('2) Mock mein 140 marks')).toBe('Mock mein 140 marks');
  });

  it('keeps numeric content intact (140 marks / 9.5 CGPA were being eaten)', () => {
    expect(stripListMarker('140 marks aaye')).toBe('140 marks aaye');
    expect(stripListMarker('9.5 CGPA mila')).toBe('9.5 CGPA mila');
    expect(stripListMarker('2 ghante padhe')).toBe('2 ghante padhe');
  });

  it('preserves facts through the plain-text fallback', () => {
    const text = ['----', '140 marks aaye', '9.5 CGPA mila', '----'].join('\n');
    const blocks = parseMemoryBlocks(text);
    expect(blocks[0].lines).toEqual(['140 marks aaye', '9.5 CGPA mila']);
  });
});

describe('MEMORY_SUMMARY_INSTRUCTIONS', () => {
  it('demands exact, lossless recall of student facts', () => {
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('PRESERVE MEANING EXACTLY');
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('must stay EXACTLY as the student wrote them');
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('Never drop negations or qualifiers');
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('SKIP it — never guess');
  });

  it('never lets the line-length guide override correctness', () => {
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('that is a GUIDE');
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('a longer accurate line is always better than a shorter wrong one');
  });

  it('still forbids repeating facts already present in prior memory', () => {
    expect(MEMORY_SUMMARY_INSTRUCTIONS).toContain('Do NOT repeat facts already present there');
  });
});

describe('shouldPinMemoryBlock', () => {
  it('pins blocks that carry durable coaching facts', () => {
    expect(shouldPinMemoryBlock({ title: 'Aim', lines: ['Target IIT Delhi', 'Weak in Calculus'] })).toBe(true);
    expect(shouldPinMemoryBlock({ lines: ['Prefers evening study sessions'] })).toBe(true);
    expect(shouldPinMemoryBlock({ lines: ['Roz 2 ghante maths karna hai'] })).toBe(true);
    expect(shouldPinMemoryBlock({ lines: ['Mock mein 140 marks aaye'] })).toBe(true);
  });

  it('demotes generic chatty blocks to normal memory', () => {
    expect(shouldPinMemoryBlock({ lines: ['Greeting exchange thi', 'Mausam bahut acha tha'] })).toBe(false);
    expect(shouldPinMemoryBlock({ lines: ['Ek chhota sa doubt puchha tha'] })).toBe(false);
    expect(shouldPinMemoryBlock({ title: 'General', lines: ['Thanks Misa, sab samajh aaya'] })).toBe(false);
  });
});
