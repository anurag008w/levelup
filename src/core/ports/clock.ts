// Clock abstraction so date-sensitive logic is unit-testable.
//
// Date handling rule: the app's day boundary follows the USER's timezone, not
// UTC. All persisted date strings (taskLogs keys, planCache keys, memory
// createdAt, etc.) are LOCAL calendar dates in the app's timezone. Day-number
// math (rawDayNumberForDate, isoAddDays) is pure calendar arithmetic and is
// therefore timezone-independent — only the "what is today" boundary and
// timestamps need timezone awareness, which these helpers provide.

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Resolves the device's IANA timezone (e.g. "Asia/Kolkata" for Indian users).
 * Falls back to Asia/Kolkata if the environment reports none.
 */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

/**
 * Timezone-aware Date -> ISO date string (YYYY-MM-DD) in the given IANA zone.
 * Falls back to UTC on an invalid timezone instead of throwing.
 */
export function isoDateInTimeZone(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Local calendar date of `d` in the device timezone (or an explicit override). */
export function isoDate(d: Date, timeZone = deviceTimeZone()): string {
  return isoDateInTimeZone(d, timeZone);
}

/** "Today" (local calendar date) for a clock in the app's timezone. */
export function todayISO(clock: Clock, timeZone = deviceTimeZone()): string {
  return isoDateInTimeZone(clock.now(), timeZone);
}
