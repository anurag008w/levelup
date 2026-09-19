import { useEffect, useState } from 'react';
import type { AppState } from '../types';
import { emptyAppState } from '../core/domain/state';
import { container } from '../di/container';
import { dateForDayNumber } from '../features/habit-engine/dates';
import { mergeDaySummary, shouldRollupDay } from '../features/ai/summary-scheduler';
import { canAutoUnlockSession, isAdminUnlocked, setAdminUnlocked, verifyAdminLogin, type AdminVerifyResult } from './admin';
import { loadSession } from './auth';
import { todayISO } from './storage';

/**
 * Single source of truth for the UI. Reads/writes through the DI container's
 * StateStore so every service sees the same object graph the screens render.
 *
 * Admin mode lets an unlocked user preview any content day of the journey:
 * `today` becomes the rest-shifted calendar date for that content day instead
 * of the real date. Everything downstream (plan builder, progress, chat
 * context) then renders that day, so the whole app acts as a time machine
 * that also honors rest-day sliding.
 */
export function useAppState() {
  const [state, setState] = useState<AppState>(() => container.store.get());
  const [realToday, setRealToday] = useState<string>(() => todayISO(container.store.get().timeZone));
  const [adminUnlocked, setAdminUnlockedState] = useState<boolean>(() => {
    const session = loadSession();
    return isAdminUnlocked(session?.username ?? null, session?.loggedInAt ?? null);
  });
  const [adminDay, setAdminDayState] = useState<number | null>(null);
  /** One-time banner when storage was full and old memories got trimmed (M7). */
  const [pruneNotice, setPruneNotice] = useState<string | null>(null);
  /** One-time banner when the last persist hit a storage WRITE failure
   *  (quota / private-mode) — data is safe in memory but will be lost on
   *  restart unless the user frees space (audit round 1). */
  const [storageWriteError, setStorageWriteError] = useState<string | null>(null);
  /** One-time banner when the CHAT blob failed to persist (quota) — chats are
   *  safe in memory but lost on restart (audit round 2 — quota asymmetry). */
  const [chatWriteError, setChatWriteError] = useState<string | null>(null);

  // Listen for external store updates (e.g., from chat tools) and sync state.
  // Hang-fix P3: event-driven — the store emits on every save, so we never
  // poll, and the UI reflects a mutation immediately instead of within 100ms.
  useEffect(() => {
    const syncFromStore = () => {
      setState(container.store.get());
      const notice = container.store.consumePruneNotice();
      if (notice) setPruneNotice(notice);
      const writeErr = container.store.consumeWriteError();
      if (writeErr) setStorageWriteError(writeErr);
      const chatWriteErr = container.consumeChatWriteError();
      if (chatWriteErr) setChatWriteError(chatWriteErr);
    };
    syncFromStore();
    return container.store.subscribe(syncFromStore);
  }, []);

  // Keep "today" fresh if the app is left open across midnight
  useEffect(() => {
    const id = setInterval(() => setRealToday(todayISO(container.store.get().timeZone)), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Day snapshot (M8): run once per calendar day on mount and on the minute tick.
  useEffect(() => {
    let cancelled = false;
    async function maybeRollupDay() {
      const s = container.store.get();
      const date = todayISO(s.timeZone);
      if (!shouldRollupDay(s, date)) return;
      let next: AppState;
      try {
        next = await container.summaries.runDailyPipeline(s, date);
      } catch {
        return;
      }
      if (cancelled) return;
      const latest = container.store.get();
      if (!shouldRollupDay(latest, date)) return;
      container.store.save(mergeDaySummary(latest, next, date));
    }
    void maybeRollupDay();
    const id = setInterval(() => void maybeRollupDay(), 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const today =
    adminUnlocked && adminDay != null && state.startDateISO
      ? dateForDayNumber(adminDay, state.startDateISO, state.restDays ?? [])
      : realToday;

  function update(updater: (s: AppState) => AppState) {
    setState((s) => {
      const next = updater(s);
      container.store.save(next);
      return next;
    });
  }

  function refresh() {
    setState(container.store.get());
  }

  function startJourney() {
    update((s) => ({ ...s, startDateISO: todayISO(s.timeZone) }));
  }

  function resetAll() {
    if (confirm('Poora progress reset karna hai? Is code SARA progress — tareeqa, tasks, memory — delete ho jayega aur ye undo nahi ho sakta. Kya aap 100% sure hain?')) {
      update(() => emptyAppState());
    }
  }

  function autoUnlock(): boolean {
    const session = loadSession();
    if (!canAutoUnlockSession(session) || !session?.username || !session.loggedInAt) return false;
    setAdminUnlocked(session.username, session.loggedInAt, true);
    setAdminUnlockedState(true);
    return true;
  }

  async function unlockAdmin(username: string, password: string): Promise<AdminVerifyResult> {
    const result = await verifyAdminLogin(username, password);
    if (!result.ok) return result;

    const session = loadSession();
    const clean = username.trim();
    if (!session || session.username.trim() !== clean || !session.loggedInAt) {
      // Verifying another account's credentials must never grant admin UI state
      // to the currently logged-in account. The local unlock marker is bound to
      // the active auth session, so a matching username + login timestamp is
      // required before the in-memory gate can turn on.
      return { ok: false, error: 'Admin unlock ke liye isi account ka active login session zaroori hai.' };
    }

    setAdminUnlocked(clean, session.loggedInAt, true);
    const unlocked = isAdminUnlocked(clean, session.loggedInAt);
    setAdminUnlockedState(unlocked);
    return unlocked
      ? { ok: true }
      : { ok: false, error: 'Admin unlock marker save nahi hua. Dobara try karo.' };
  }

  function lockAdmin() {
    const session = loadSession();
    setAdminUnlocked(session?.username ?? null, session?.loggedInAt ?? null, false);
    setAdminUnlockedState(false);
    setAdminDayState(null);
  }

  function setAdminDay(day: number | null) {
    setAdminDayState(day);
  }

  return { state, today, update, refresh, startJourney, resetAll, adminUnlocked, adminDay, unlockAdmin, autoUnlock, lockAdmin, setAdminDay, pruneNotice, dismissPruneNotice: () => setPruneNotice(null), storageWriteError, dismissStorageWriteError: () => setStorageWriteError(null), chatWriteError, dismissChatWriteError: () => setChatWriteError(null) };
}
