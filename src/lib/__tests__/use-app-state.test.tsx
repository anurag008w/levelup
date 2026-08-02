// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { container } from '../../di/container';
import { emptyAppState } from '../../core/domain/state';
import { isoAddDays } from '../../features/habit-engine/dates';
import { useAppState } from '../useAppState';

describe('useAppState', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  it('boots from the container store with a real today', () => {
    const { result } = renderHook(() => useAppState());
    expect(result.current.state).toEqual(emptyAppState());
    expect(result.current.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('update applies the updater and persists to the store', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.update((s) => ({ ...s, bonusDaysUsed: 3 }));
    });
    expect(result.current.state.bonusDaysUsed).toBe(3);
    expect(container.store.get().bonusDaysUsed).toBe(3);
  });

  it('startJourney stamps today as the start date', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.startJourney();
    });
    expect(result.current.state.startDateISO).toBe(result.current.today);
  });

  it('admin preview rewinds/pushes today to the previewed journey day', () => {
    const start = '2026-01-01';
    container.store.save({ ...emptyAppState(), startDateISO: start });
    const { result } = renderHook(() => useAppState());
    expect(result.current.adminUnlocked).toBe(false);

    act(() => {
      expect(result.current.unlockAdmin('anurag008_w', 'admin2008')).toBe(true);
      result.current.setAdminDay(5);
    });
    expect(result.current.adminUnlocked).toBe(true);
    expect(result.current.today).toBe(isoAddDays(start, 4)); // day 5 → start + 4

    act(() => {
      result.current.lockAdmin();
    });
    expect(result.current.adminUnlocked).toBe(false);
    expect(result.current.today).not.toBe(isoAddDays(start, 4));
  });

  it('rejects wrong admin credentials without unlocking', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      expect(result.current.unlockAdmin('wrong', 'nope')).toBe(false);
    });
    expect(result.current.adminUnlocked).toBe(false);
  });

  it('refresh re-reads the store after external mutations', () => {
    const { result } = renderHook(() => useAppState());
    container.store.save({ ...emptyAppState(), startDateISO: '2026-02-02' });
    act(() => {
      result.current.refresh();
    });
    expect(result.current.state.startDateISO).toBe('2026-02-02');
  });
});
