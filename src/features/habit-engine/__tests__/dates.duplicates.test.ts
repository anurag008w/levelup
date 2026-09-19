import { describe, expect, it } from 'vitest';
import {
  contentDayForRaw,
  dateForContentDay,
  dateForDayNumber,
  dateForRestDay,
  rawForContentDay,
  restRawPositions,
} from '../dates';

describe('rest-day mapping tolerates duplicate persisted entries', () => {
  const START = '2026-01-01';

  it('treats duplicate rest-day numbers as one calendar rest', () => {
    const duplicated = [5, 5];
    const normalized = [5];

    expect(restRawPositions(duplicated)).toEqual(restRawPositions(normalized));
    expect(contentDayForRaw(6, duplicated)).toBe(contentDayForRaw(6, normalized));
    expect(rawForContentDay(90, duplicated)).toBe(rawForContentDay(90, normalized));
    expect(dateForContentDay(90, START, duplicated)).toBe(dateForContentDay(90, START, normalized));
    expect(dateForRestDay(5, START, duplicated)).toBe(dateForRestDay(5, START, normalized));
    expect(dateForDayNumber(5, START, duplicated)).toBe(dateForDayNumber(5, START, normalized));
  });

  it('deduplicates repeated values without disturbing distinct rest-day ordering', () => {
    expect(restRawPositions([30, 5, 14, 5, 14])).toEqual([5, 15, 32]);
  });
});
