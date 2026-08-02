import { describe, it, expect } from 'vitest';
import { parseMemoryBlocks, MAX_BLOCK_LINES, shouldPinMemoryBlock } from '../../../core/domain/memory-summary';

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

  it('caps every block at 8 lines (keeps up to 8 important points)', () => {
    const text = '{"blocks":[{"lines":["1","2","3","4","5","6","7","8","9","10"],"longTerm":false}]}';
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(MAX_BLOCK_LINES);
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

  it('falls back to plain text separated by ---- blocks (max 8 lines each)', () => {
    const text = [
      'Week 1: Physics strong, Calculus weak',
      'Roz 2 ghante padhna hai',
      '----',
      'Target: IIT Delhi',
      'Mock mein 140 marks aaye',
    ].join('\n');
    const blocks = parseMemoryBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lines).toEqual(['Week 1: Physics strong, Calculus weak', 'Roz 2 ghante padhna hai']);
    expect(blocks[1].lines).toEqual(['Target: IIT Delhi', 'Mock mein 140 marks aaye']);
  });

  it('returns an empty array for empty or invalid replies', () => {
    expect(parseMemoryBlocks('')).toEqual([]);
    expect(parseMemoryBlocks('   ')).toEqual([]);
    expect(parseMemoryBlocks('no blocks here at all')).toEqual([]);
    expect(parseMemoryBlocks('{"foo":"bar"}')).toEqual([]);
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
