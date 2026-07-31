import type { AppState } from '../types';

const KEY = 'human-os-state-v1';

export function loadState(): AppState {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    return {
      startDateISO: null,
      bonusDaysUsed: 0,
      taskLogs: {},
      weeklyReviews: [],
      monthlyAssessments: [],
      failureLog: [],
      examDateISO: null,
      clearedLevels: [],
    };
  }
  try {
    return JSON.parse(raw) as AppState;
  } catch {
    return {
      startDateISO: null,
      bonusDaysUsed: 0,
      taskLogs: {},
      weeklyReviews: [],
      monthlyAssessments: [],
      failureLog: [],
      examDateISO: null,
      clearedLevels: [],
    };
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateISO(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
