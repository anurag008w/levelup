// Clock abstraction so date-sensitive logic is unit-testable.

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayISO(clock: Clock): string {
  return isoDate(clock.now());
}
