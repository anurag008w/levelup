import { describe, it, expect } from 'vitest';
import {
  dateToISO,
  isoAddDays,
  rawDayNumberForDate,
  currentDayNumberFor,
  daysBetween,
  contentDayForDate,
  dateForContentDay,
  isRestDate,
  isRestRaw,
  restRawPositions,
  contentDayForRaw,
  rawForContentDay,
  dateForRestDay,
} from '../dates';

describe('date helpers', () => {
  it('dateToISO slices the UTC calendar date', () => {
    expect(dateToISO(new Date('2026-03-01T12:00:00Z'))).toBe('2026-03-01');
    expect(dateToISO(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31');
  });

  it('isoAddDays steps in pure calendar arithmetic', () => {
    expect(isoAddDays('2026-01-01', 1)).toBe('2026-01-02');
    expect(isoAddDays('2026-01-01', 0)).toBe('2026-01-01');
    expect(isoAddDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('isoAddDays crosses month and leap-year boundaries', () => {
    expect(isoAddDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(isoAddDays('2026-02-28', 1)).toBe('2026-03-01'); // non-leap 2026
    expect(isoAddDays('2024-02-28', 1)).toBe('2024-02-29'); // leap 2024
    expect(isoAddDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rawDayNumberForDate is 1-indexed from the start date', () => {
    expect(rawDayNumberForDate('2026-01-01', '2026-01-01')).toBe(1);
    expect(rawDayNumberForDate('2026-01-02', '2026-01-01')).toBe(2);
    expect(rawDayNumberForDate('2025-12-31', '2026-01-01')).toBe(0);
    expect(rawDayNumberForDate('2026-03-31', '2026-01-01')).toBe(90);
    expect(rawDayNumberForDate('2026-04-01', '2026-01-01')).toBe(91);
  });

  it('currentDayNumberFor clamps to [1, totalDays]', () => {
    expect(currentDayNumberFor('2025-12-31', '2026-01-01', 90)).toBe(1); // pre-start clamps up
    expect(currentDayNumberFor('2026-01-01', '2026-01-01', 90)).toBe(1);
    expect(currentDayNumberFor('2026-03-31', '2026-01-01', 90)).toBe(90);
    expect(currentDayNumberFor('2026-05-01', '2026-01-01', 90)).toBe(90); // post-end clamps down
    expect(currentDayNumberFor('2026-05-01', '', 90)).toBe(0); // no start → 0
  });

  it('daysBetween returns signed whole-day differences', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1);
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(-1);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-01', '2026-03-31')).toBe(89);
  });

  describe('rest-day content mapping', () => {
    const START = '2026-01-01';

    it('no rests: content day == raw day, dates unchanged', () => {
      expect(contentDayForDate('2026-01-10', START, [])).toBe(10);
      expect(dateForContentDay(10, START, [])).toBe('2026-01-10');
      expect(isRestDate('2026-01-10', START, [])).toBe(false);
      expect(restRawPositions([])).toEqual([]);
    });

    it('a rest consumes one calendar slot: content days after it slide one day', () => {
      // restDays [5] → raw 5 is the rest; raw 6 plays content 5; raw 91 plays content 90.
      expect(restRawPositions([5])).toEqual([5]);
      expect(isRestRaw(5, [5])).toBe(true);
      expect(isRestRaw(6, [5])).toBe(false);
      expect(contentDayForRaw(5, [5])).toBe(5); // the rested content day
      expect(contentDayForRaw(6, [5])).toBe(5); // first real study after the rest
      expect(contentDayForRaw(91, [5])).toBe(90);
      expect(rawForContentDay(5, [5])).toBe(6); // content 5 plays a day later
      expect(rawForContentDay(90, [5])).toBe(91); // journey extends one calendar day
      expect(dateForContentDay(90, START, [5])).toBe('2026-04-01');
      expect(dateForRestDay(5, START, [5])).toBe('2026-01-05');
    });

    it('multiple rests stack: each rest pushes everything after it one slot further', () => {
      const rests = [5, 14, 30];
      expect(restRawPositions(rests)).toEqual([5, 15, 32]); // each rest day's own slot shifts too
      expect(contentDayForRaw(5, rests)).toBe(5);
      expect(contentDayForRaw(15, rests)).toBe(14); // second rest slot
      expect(contentDayForRaw(16, rests)).toBe(14); // first content day after rest 14
      expect(contentDayForRaw(32, rests)).toBe(30);
      expect(contentDayForRaw(33, rests)).toBe(30);
      expect(contentDayForRaw(34, rests)).toBe(31);
      expect(contentDayForRaw(93, rests)).toBe(90); // 90 content + 3 rests = 93 raw days
      expect(rawForContentDay(90, rests)).toBe(93);
      expect(dateForContentDay(90, START, rests)).toBe('2026-04-03');
    });

    it('contentDayForDate + dateForContentDay are inverse on non-rest dates', () => {
      const rests = [7, 21, 35, 50];
      for (const contentDay of [1, 2, 6, 7, 8, 20, 21, 22, 34, 35, 36, 49, 50, 51, 89, 90]) {
        const date = dateForContentDay(contentDay, START, rests);
        if (!rests.includes(contentDay)) {
          expect(contentDayForDate(date, START, rests)).toBe(contentDay);
        }
      }
    });

    it('isRestDate flags the calendar slot of every rest content day', () => {
      const rests = [3, 10];
      expect(isRestDate('2026-01-03', START, rests)).toBe(true); // raw 3
      expect(isRestDate('2026-01-11', START, rests)).toBe(true); // rest 10 sits at raw 11
      expect(isRestDate('2026-01-04', START, rests)).toBe(false);
      expect(isRestDate('2026-01-12', START, rests)).toBe(false);
    });

    it('consecutive rests slide content days further', () => {
      const rests = [6, 7];
      expect(restRawPositions(rests)).toEqual([6, 8]);
      expect(contentDayForRaw(6, rests)).toBe(6);
      expect(contentDayForRaw(8, rests)).toBe(7);
      expect(contentDayForRaw(9, rests)).toBe(7); // first content day after the 2-day break
      expect(contentDayForRaw(10, rests)).toBe(8);
      expect(rawForContentDay(90, rests)).toBe(92);
    });

    it('restRawPositions handles unsorted input deterministically', () => {
      expect(restRawPositions([30, 5, 14])).toEqual([5, 15, 32]);
    });
  });
});
