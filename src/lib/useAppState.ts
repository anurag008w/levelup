import { useEffect, useState } from 'react';
import type { AppState } from '../types';
import { emptyAppState } from '../core/domain/state';
import { container } from '../di/container';
import { todayISO } from './storage';

/**
 * Single source of truth for the UI. Reads/writes through the DI container's
 * StateStore so every service sees the same object graph the screens render.
 */
export function useAppState() {
  const [state, setState] = useState<AppState>(() => container.store.get());
  const [today, setToday] = useState<string>(() => todayISO());

  // Keep "today" fresh if the app is left open across midnight
  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  function update(updater: (s: AppState) => AppState) {
    setState((s) => {
      const next = updater(s);
      container.store.save(next);
      return next;
    });
  }

  /** Re-reads the store snapshot (after service-level mutations, e.g. chat tools). */
  function refresh() {
    setState(container.store.get());
  }

  function startJourney() {
    update((s) => ({ ...s, startDateISO: todayISO() }));
  }

  function resetAll() {
    if (confirm('Poora progress reset karna hai? Ye undo nahi ho sakta.')) {
      update(() => emptyAppState());
    }
  }

  return { state, today, update, refresh, startJourney, resetAll };
}
