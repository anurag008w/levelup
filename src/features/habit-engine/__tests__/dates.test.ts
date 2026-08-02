import { describe, it, expect } from 'vitest';
import { dateToISO, isoAddDays, rawDayNumberForDate, currentDayNumberFor, daysBetween } from '../dates';

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
});
