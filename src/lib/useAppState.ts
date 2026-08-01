import { useEffect, useState } from 'react';
import type { AppState } from '../types';
import { emptyAppState } from '../core/domain/state';
import { container } from '../di/container';
import { isoAddDays } from '../features/habit-engine/dates';
import { isAdminUnlocked, setAdminUnlocked, verifyAdmin } from './admin';
import { todayISO } from './storage';

/**
 * Single source of truth for the UI. Reads/writes through the DI container's
 * StateStore so every service sees the same object graph the screens render.
 *
 * Admin mode lets an unlocked user preview any day of the 90-day journey:
 * `today` becomes `startDateISO + (adminDay - 1)` instead of the real date.
 * Everything downstream (plan builder, progress, chat context) then renders
 * that day, so the whole app acts as a 90-day time machine.
 */
export function useAppState() {
  const [state, setState] = useState<AppState>(() => container.store.get());
  const [realToday, setRealToday] = useState<string>(() => todayISO());
  const [adminUnlocked, setAdminUnlockedState] = useState<boolean>(() => isAdminUnlocked());
  const [adminDay, setAdminDayState] = useState<number | null>(null);

  // Listen for external store updates (e.g., from chat tools) and sync state
  useEffect(() => {
    let lastState = container.store.get();
    const checkInterval = setInterval(() => {
      const currentState = container.store.get();
      if (currentState !== lastState) {
        lastState = currentState;
        setState(currentState);
      }
    }, 100); // Check every 100ms for external changes
    return () => clearInterval(checkInterval);
  }, []);

  // Keep "today" fresh if the app is left open across midnight
  useEffect(() => {
    const id = setInterval(() => setRealToday(todayISO()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const today =
    adminUnlocked && adminDay != null && state.startDateISO
      ? isoAddDays(state.startDateISO, adminDay - 1)
      : realToday;

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

  /** Tries the admin credentials; returns true and unlocks on success. */
  function unlockAdmin(username: string, password: string): boolean {
    if (!verifyAdmin(username, password)) return false;
    setAdminUnlocked(true);
    setAdminUnlockedState(true);
    return true;
  }

  /** Locks the panel and drops any previewed day. */
  function lockAdmin() {
    setAdminUnlocked(false);
    setAdminUnlockedState(false);
    setAdminDayState(null);
  }

  /** Jumps the preview to an absolute day (1-based); null returns to real date. */
  function setAdminDay(day: number | null) {
    setAdminDayState(day);
  }

  return { state, today, update, refresh, startJourney, resetAll, adminUnlocked, adminDay, unlockAdmin, lockAdmin, setAdminDay };
}
