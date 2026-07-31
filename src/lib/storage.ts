import type { AppState } from '../types';
import { BrowserStorage } from '../infra/storage/local-storage';
import { LocalStateRepository, normalizeState, STATE_KEY, STATE_KEY_V1 } from '../infra/storage/state-repository';

const store = new BrowserStorage();
const repository = new LocalStateRepository(store);

export function loadState(): AppState {
  return repository.load();
}

export function saveState(state: AppState) {
  repository.save(state);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateISO(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Exposed for diagnostics / future "reset" UI. The v1 key is deliberately kept.
export function storageKeys(): { v1: string; v2: string } {
  return { v1: STATE_KEY_V1, v2: STATE_KEY };
}

export { normalizeState };
