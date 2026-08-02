import type { AppState } from '../types';
import { BrowserStorage } from '../infra/storage/local-storage';
import { LocalStateRepository, normalizeState, STATE_KEY, STATE_KEY_V1 } from '../infra/storage/state-repository';
import { deviceTimeZone, isoDateInTimeZone } from '../core/ports/clock';
import { isoAddDays } from '../features/habit-engine/dates';

const store = new BrowserStorage();
const repository = new LocalStateRepository(store);

export function loadState(): AppState {
  return repository.load();
}

export function saveState(state: AppState) {
  repository.save(state);
}

/**
 * Local calendar date for "now" in the app's timezone.
 * @param timeZone explicit IANA zone; null/undefined falls back to the device.
 */
export function todayISO(timeZone?: string | null): string {
  return isoDateInTimeZone(new Date(), timeZone ?? deviceTimeZone());
}

/**
 * Local calendar date `offsetDays` from today in the app's timezone. Uses pure
 * calendar arithmetic so an IST (+5:30) early-morning shift can't leak into
 * the result the way the old local-setDate + UTC-slice did.
 */
export function dateISO(offsetDays: number, timeZone?: string | null): string {
  return isoAddDays(todayISO(timeZone), offsetDays);
}

// Exposed for diagnostics / future "reset" UI. The v1 key is deliberately kept.
export function storageKeys(): { v1: string; v2: string } {
  return { v1: STATE_KEY_V1, v2: STATE_KEY };
}

export { normalizeState };
