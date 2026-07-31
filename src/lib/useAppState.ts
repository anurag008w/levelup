import { useEffect, useState } from 'react';
import type { AppState } from '../types';
import { loadState, saveState, todayISO } from './storage';

export function useAppState() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [today, setToday] = useState<string>(() => todayISO());

  useEffect(() => {
    saveState(state);
  }, [state]);

  // Keep "today" fresh if the app is left open across midnight
  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  function update(updater: (s: AppState) => AppState) {
    setState((s) => updater(s));
  }

  function startJourney() {
    update((s) => ({ ...s, startDateISO: todayISO() }));
  }

  function resetAll() {
    if (confirm('Poora progress reset karna hai? Ye undo nahi ho sakta.')) {
      update(() => ({
        startDateISO: null,
        bonusDaysUsed: 0,
        taskLogs: {},
        weeklyReviews: [],
        monthlyAssessments: [],
        failureLog: [],
        examDateISO: null,
        clearedLevels: [],
      }));
    }
  }

  return { state, today, update, startJourney, resetAll };
}
