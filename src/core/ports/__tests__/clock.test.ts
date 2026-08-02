import { describe, expect, it } from 'vitest';
import { deviceTimeZone, isoDate, isoDateInTimeZone, todayISO } from '../clock';

const fixedClock = {
  now: () => new Date('2026-08-02T18:59:00.000Z'),
};

describe('isoDateInTimeZone', () => {
  it('converts an instant to the local calendar date in Asia/Kolkata', () => {
    // 2026-08-02T18:30Z == 2026-08-03T00:00 IST (raat 12 baje naya day).
    expect(isoDateInTimeZone(new Date('2026-08-02T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-08-03');
    // Early morning IST is still the SAME calendar day, not the previous UTC day.
    expect(isoDateInTimeZone(new Date('2026-08-02T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-08-03');
    expect(isoDateInTimeZone(new Date('2026-08-02T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-08-03');
  });

  it('stays on the previous local day before midnight IST', () => {
    // 2026-08-02T18:00Z == 2026-08-02T23:30 IST — still Aug 2 locally.
    expect(isoDateInTimeZone(new Date('2026-08-02T18:00:00Z'), 'Asia/Kolkata')).toBe('2026-08-02');
  });

  it('agrees with UTC slicing when formatting in UTC', () => {
    expect(isoDateInTimeZone(new Date('2026-08-02T05:00:00Z'), 'UTC')).toBe('2026-08-02');
    expect(isoDateInTimeZone(new Date('2026-08-02T23:00:00Z'), 'UTC')).toBe('2026-08-02');
  });

  it('is stable across a month boundary', () => {
    expect(isoDateInTimeZone(new Date('2026-07-31T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-08-01');
    expect(isoDateInTimeZone(new Date('2026-07-31T18:00:00Z'), 'Asia/Kolkata')).toBe('2026-07-31');
  });

  it('falls back to UTC for an invalid timezone instead of throwing', () => {
    expect(isoDateInTimeZone(new Date('2026-08-02T12:00:00Z'), 'Not/AZone')).toBe('2026-08-02');
  });
});

describe('todayISO', () => {
  it('returns the local calendar date for an explicit timezone', () => {
    // 18:59 UTC = 00:29 IST next day.
    expect(todayISO(fixedClock, 'Asia/Kolkata')).toBe('2026-08-03');
    expect(todayISO(fixedClock, 'UTC')).toBe('2026-08-02');
  });
});

describe('isoDate', () => {
  it('defaults to the device timezone but accepts an override', () => {
    expect(isoDate(new Date('2026-08-02T12:00:00Z'), 'UTC')).toBe('2026-08-02');
    expect(isoDate(new Date('2026-08-02T12:00:00Z'), 'Asia/Kolkata')).toBe('2026-08-02');
  });
});

describe('deviceTimeZone', () => {
  it('always resolves to a non-empty IANA identifier', () => {
    const tz = deviceTimeZone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
    expect(tz).toMatch(/\w+\/\w+/);
  });
});
