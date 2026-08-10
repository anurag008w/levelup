// Pure date helpers. Deterministic, testable.

const MS_DAY = 24 * 60 * 60 * 1000;

export function dateToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseISODateUTC(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoAddDays(iso: string, days: number): string {
  const d = parseISODateUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToISO(d);
}

/** Raw day number (1-indexed) for any calendar date relative to a start date. */
export function rawDayNumberForDate(dateISO: string, startDateISO: string): number {
  const start = parseISODateUTC(startDateISO).getTime();
  const day = parseISODateUTC(dateISO).getTime();
  return Math.floor((day - start) / MS_DAY) + 1;
}

export function currentDayNumberFor(dateISO: string, startDateISO: string, totalDays: number): number {
  if (!startDateISO) return 0;
  const raw = rawDayNumberForDate(dateISO, startDateISO);
  return Math.min(Math.max(raw, 1), totalDays);
}

// ===== Rest-day content mapping =====
//
// Rest days SLIDE the journey: a rest day consumes one calendar slot but no
// content. `restDays` stores the CONTENT day numbers that are rested (e.g. 5
// means "content day 5 is a rest"). Because rests push every later content day
// one calendar slot forward, a content day's calendar position depends on how
// many rests come before it:
//
//   rest day d     sits at raw position d + (# rests < d)
//   content day c  plays at raw position c + (# rests ≤ c)
//   raw r          is content (r − # rests < r), or IS a rest slot
//
// Example with restDays=[5]: raw 5 is the rest (content 5 skipped), raw 6 plays
// content 5, raw 7 plays content 6, … raw 91 plays content 90 (journey extends
// by one calendar day). All helpers are pure/deterministic.

/** Sorted calendar positions (raw day numbers) of the rest days. */
export function restRawPositions(restDays: number[]): number[] {
  const sorted = [...restDays].sort((a, b) => a - b);
  return sorted.map((d, i) => d + i);
}

/** Content day number for a raw calendar day. On a rest slot this returns the
 *  content day that is rested that day. */
export function contentDayForRaw(raw: number, restDays: number[]): number {
  const rests = restRawPositions(restDays);
  let before = 0;
  for (const r of rests) if (r < raw) before++;
  return raw - before;
}

/** True when this raw calendar day is a rest day. */
export function isRestRaw(raw: number, restDays: number[]): boolean {
  return restRawPositions(restDays).includes(raw);
}

/** Calendar raw position on which content day c actually plays. */
export function rawForContentDay(c: number, restDays: number[]): number {
  return c + restDays.filter((d) => d <= c).length;
}

/** Content day for a calendar date (1 = first content day). */
export function contentDayForDate(dateISO: string, startDateISO: string, restDays: number[]): number {
  return contentDayForRaw(rawDayNumberForDate(dateISO, startDateISO), restDays);
}

/** True when this calendar date is a rest day. */
export function isRestDate(dateISO: string, startDateISO: string, restDays: number[]): boolean {
  return isRestRaw(rawDayNumberForDate(dateISO, startDateISO), restDays);
}

/** Calendar date on which content day c plays. */
export function dateForContentDay(contentDay: number, startDateISO: string, restDays: number[]): string {
  return isoAddDays(startDateISO, rawForContentDay(contentDay, restDays) - 1);
}

/** Calendar date of the rest day for content day d. */
export function dateForRestDay(restDay: number, startDateISO: string, restDays: number[]): string {
  const raw = restDay + restDays.filter((d) => d < restDay).length;
  return isoAddDays(startDateISO, raw - 1);
}

/** Calendar date for a day number. Rested content days map to their REST slot
 *  (the actual calendar day off), every other day to its content date. This is
 *  what UIs (DaySwitcher, chat tools) need: jumping to a rested content day
 *  must land on the real rest day, not the shifted day after it. */
export function dateForDayNumber(dayNumber: number, startDateISO: string, restDays: number[]): string {
  return restDays.includes(dayNumber)
    ? dateForRestDay(dayNumber, startDateISO, restDays)
    : dateForContentDay(dayNumber, startDateISO, restDays);
}

export function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (parseISODateUTC(bISO).getTime() - parseISODateUTC(aISO).getTime()) / MS_DAY,
  );
}
