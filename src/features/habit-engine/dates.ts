// Pure date helpers. Deterministic, testable.

const MS_DAY = 24 * 60 * 60 * 1000;

export function dateToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateToISO(d);
}

/** Raw day number (1-indexed) for any calendar date relative to a start date. */
export function rawDayNumberForDate(dateISO: string, startDateISO: string): number {
  const start = new Date(startDateISO + 'T00:00:00').getTime();
  const day = new Date(dateISO + 'T00:00:00').getTime();
  return Math.floor((day - start) / MS_DAY) + 1;
}

export function currentDayNumberFor(dateISO: string, startDateISO: string, totalDays: number): number {
  if (!startDateISO) return 0;
  const raw = rawDayNumberForDate(dateISO, startDateISO);
  return Math.min(Math.max(raw, 1), totalDays);
}

export function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (new Date(bISO + 'T00:00:00').getTime() - new Date(aISO + 'T00:00:00').getTime()) / MS_DAY,
  );
}
