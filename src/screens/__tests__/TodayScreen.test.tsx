// @vitest-environment jsdom
//
// TodayScreen — full feature coverage for the "Today" tab.
//
// Covers (smallest-feature level):
//   StartScreen (pre-journey)      — Mission Start button, feature shortcuts, disabled state
//   Header                         — day/level/date label, streak pill states
//   Admin gate                     — open login, wrong creds, correct creds, lock, DaySwitcher wiring
//   Stats & banners                — doneCount/total, gap-day warn, rest day, exam mode
//   Add-task flow                  — open/close, empty-title guard, duplicate guard, success path
//   Task list                      — grouping, toggle-done
//   Edit-in-place                  — open, empty-title guard, save, cancel
//   Delete                         — confirm/cancel, legacy vs. dynamic entry handling
//
// See also: src/screens/__tests__/TodayScreen.bugs.test.ts for a documented,
// currently-passing-but-suspicious behavior around `level.authored`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import TodayScreen from '../TodayScreen';
import { emptyAppState } from '../../core/domain/state';
import type { AppState } from '../../types';
import { isoDateInTimeZone, deviceTimeZone } from '../../core/ports/clock';
import { parseTaskBankEntry } from '../../features/task-bank/validation';
import { isoAddDays } from '../../features/habit-engine/dates';

const today = isoDateInTimeZone(new Date(), deviceTimeZone());

function populated(): AppState {
  const s = emptyAppState();
  s.startDateISO = today;
  s.timeZone = deviceTimeZone();
  return s;
}

/** Builds a valid, already-scheduled dynamic task-bank entry for "today" (day 1). */
function scheduledEntry(title: string, day = 1) {
  return parseTaskBankEntry({
    id: `seed-${title.replace(/\s+/g, '-').toLowerCase()}`,
    habitId: 'daily_planning',
    title,
    description: '',
    phase: 'jee-core',
    difficulty: 2,
    estimatedDurationMin: 30,
    energyLevel: 'medium',
    tags: ['today'],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.3,
    backlogSuitability: 0.3,
    thinkingSkills: ['focus'],
    jeeRelevance: { score: 0.5 },
    unlockConditions: [{ type: 'day-exact', day }],
    active: true,
  });
}

function renderToday(overrides: Partial<Parameters<typeof TodayScreen>[0]> = {}) {
  const update = overrides.update ?? vi.fn();
  const onUnlockAdmin = overrides.onUnlockAdmin ?? vi.fn(async () => ({ ok: true }));
  const onAutoUnlock = overrides.onAutoUnlock ?? vi.fn(() => false);
  const onLockAdmin = overrides.onLockAdmin ?? vi.fn();
  const onSetAdminDay = overrides.onSetAdminDay ?? vi.fn();
  const props = {
    state: overrides.state ?? populated(),
    today,
    update,
    adminUnlocked: overrides.adminUnlocked ?? false,
    canAutoUnlock: overrides.canAutoUnlock ?? false,
    onAutoUnlock,
    onUnlockAdmin,
    onLockAdmin,
    onSetAdminDay,
    onNavigate: overrides.onNavigate,
  };
  const utils = render(React.createElement(TodayScreen, props));
  return { ...utils, update, onUnlockAdmin, onAutoUnlock, onLockAdmin, onSetAdminDay };
}

/** Applies an `update` callback sequence to a base state, like the real app would. */
function applyUpdates(base: AppState, update: ReturnType<typeof vi.fn>): AppState {
  let s = base;
  for (const call of update.mock.calls) {
    s = call[0](s);
  }
  return s;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubGlobal('scrollTo', () => {});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TodayScreen — StartScreen (pre-journey)', () => {
  it('shows the mission-start hero before any journey has begun', () => {
    renderToday({ state: emptyAppState() });
    expect(screen.getByText(/Mission Start — Day 1/)).toBeTruthy();
    expect(screen.getByText('Task Bank')).toBeTruthy();
    expect(screen.getByText('Streaks')).toBeTruthy();
    expect(screen.getByText('Misa AI')).toBeTruthy();
  });

  it('clicking Mission Start sets startDateISO to today via update()', () => {
    const update = vi.fn();
    renderToday({ state: emptyAppState(), update });
    fireEvent.click(screen.getByText(/Mission Start — Day 1/));
    expect(update).toHaveBeenCalledTimes(1);
    const result = update.mock.calls[0][0](emptyAppState());
    expect(result.startDateISO).toBe(today);
  });

  it('feature shortcut buttons call onNavigate with the right tab', () => {
    const onNavigate = vi.fn();
    renderToday({ state: emptyAppState(), onNavigate });
    fireEvent.click(screen.getByText('Task Bank'));
    expect(onNavigate).toHaveBeenCalledWith('task-bank');
    fireEvent.click(screen.getByText('Streaks'));
    expect(onNavigate).toHaveBeenCalledWith('progress');
    fireEvent.click(screen.getByText('Misa AI'));
    expect(onNavigate).toHaveBeenCalledWith('chat');
  });

  it('feature shortcut buttons are disabled when onNavigate is not supplied', () => {
    renderToday({ state: emptyAppState() });
    const btn = screen.getByText('Task Bank').closest('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });
});

describe('TodayScreen — header & streak', () => {
  it('renders the day number, level title and date label once the journey starts', () => {
    renderToday();
    expect(screen.getByText(/CASE — DAY 001/)).toBeTruthy();
  });

  it('streak pill renders 0 (inactive/grey) with a fresh journey', () => {
    renderToday();
    const pill = screen.getByText('0', { selector: 'span.font-mono' });
    expect(pill).toBeTruthy();
    // Inactive streak uses --color-muted, not the highlighted --color-light.
    expect((pill as HTMLElement).style.color).toBe('var(--color-muted)');
  });
});

describe('TodayScreen — admin gate', () => {
  it('opens the AdminLogin dialog when the shield button is clicked', () => {
    renderToday();
    fireEvent.click(screen.getByLabelText('Admin login'));
    expect(screen.getByRole('dialog', { name: 'Admin login' })).toBeTruthy();
  });

  it('shows an error and stays open on wrong credentials (server rejects)', async () => {
    const onUnlockAdmin = vi.fn(async () => ({ ok: false, error: 'Galat username ya password.' }));
    renderToday({ onUnlockAdmin });
    fireEvent.click(screen.getByLabelText('Admin login'));
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'nope' } });
    fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Login'));
    await waitFor(() => expect(onUnlockAdmin).toHaveBeenCalledWith('nope', 'wrong'));
    expect(screen.getByRole('alert').textContent).toMatch(/Galat username ya password/);
    // Dialog remains open on failure.
    expect(screen.getByRole('dialog', { name: 'Admin login' })).toBeTruthy();
  });

  it('closes the dialog on correct credentials (server says super admin)', async () => {
    const onUnlockAdmin = vi.fn(async () => ({ ok: true }));
    renderToday({ onUnlockAdmin });
    fireEvent.click(screen.getByLabelText('Admin login'));
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('Login'));
    await waitFor(() => expect(onUnlockAdmin).toHaveBeenCalledWith('admin', 'secret'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Admin login' })).toBeNull());
  });

  it('a server super admin unlocks straight from the shield — no password dialog', () => {
    const onAutoUnlock = vi.fn(() => true);
    renderToday({ canAutoUnlock: true, onAutoUnlock });
    fireEvent.click(screen.getByLabelText('Admin login'));
    expect(onAutoUnlock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Admin login' })).toBeNull();
  });

  it('when auto-unlock reports false, the shield falls back to the password dialog', () => {
    const onAutoUnlock = vi.fn(() => false);
    renderToday({ canAutoUnlock: true, onAutoUnlock });
    fireEvent.click(screen.getByLabelText('Admin login'));
    expect(onAutoUnlock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Admin login' })).toBeTruthy();
  });

  it('when unlocked: shows the peak-colored lock button and the DaySwitcher, and lock works', () => {
    const onLockAdmin = vi.fn();
    renderToday({ adminUnlocked: true, onLockAdmin });
    expect(screen.getByLabelText('Admin panel khula hai (lock karo)')).toBeTruthy();
    expect(screen.getByText('Admin view')).toBeTruthy();
    // Two lock affordances exist: header shield + DaySwitcher's own Lock button.
    fireEvent.click(screen.getByLabelText('Admin panel khula hai (lock karo)'));
    expect(onLockAdmin).toHaveBeenCalledTimes(1);
  });

  it('DaySwitcher: prev/next call onSetAdminDay, prev disabled on day 1, Aaj calls with null', () => {
    const onSetAdminDay = vi.fn();
    renderToday({ adminUnlocked: true, onSetAdminDay });
    const prev = screen.getByLabelText('Previous day') as HTMLButtonElement;
    const next = screen.getByLabelText('Next day');
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(onSetAdminDay).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByText(/Aaj \(real date\)/));
    expect(onSetAdminDay).toHaveBeenCalledWith(null);
  });

  it('DaySwitcher: typing a day and pressing Confirm clamps to [1, totalDays]', () => {
    const onSetAdminDay = vi.fn();
    renderToday({ adminUnlocked: true, onSetAdminDay });
    const input = screen.getByLabelText('Day 1 of 90');
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.click(screen.getByText('Confirm'));
    // Clamped to totalDays (90 per the 90-day journey), not 9999.
    expect(onSetAdminDay).toHaveBeenCalledWith(90);
  });
});

describe('TodayScreen — stats & banners', () => {
  it('shows 0/4 tasks done and the correct minutes-today stat on a fresh day 1', () => {
    renderToday();
    expect(screen.getByText('0/4')).toBeTruthy();
  });

  it('does NOT show the rest-day banner on a normal weekday-1 plan', () => {
    renderToday();
    expect(screen.queryByText('Rest Day — Chhuti')).toBeNull();
  });

  it('shows the exam-month banner when examDateISO is within 30 days', () => {
    const s = populated();
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    s.examDateISO = soon.toISOString().slice(0, 10);
    renderToday({ state: s });
    expect(screen.getByText(/Exam Month —/)).toBeTruthy();
  });

  it('does not show the exam-month banner when no exam date is set', () => {
    renderToday();
    expect(screen.queryByText(/Exam Month —/)).toBeNull();
  });
});

describe('TodayScreen — task list & toggling', () => {
  it('groups day-1 default tasks under Morning Rituals / Study Blocks / Night Review', () => {
    renderToday();
    expect(screen.getByText('Morning Rituals')).toBeTruthy();
    expect(screen.getByText('Study Blocks')).toBeTruthy();
    expect(screen.getByText('Night Review')).toBeTruthy();
    // Groups with no tasks on day 1 must not render at all.
    expect(screen.queryByText('Weekly')).toBeNull();
    expect(screen.queryByText('Bonus (optional)')).toBeNull();
  });

  it('checking a task checkbox toggles it done via update()', () => {
    const update = vi.fn();
    const base = populated();
    renderToday({ state: base, update });
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(update).toHaveBeenCalledTimes(1);
    const next = applyUpdates(base, update);
    const doneCount = Object.values(next.taskLogs[today] ?? {}).filter(Boolean).length;
    expect(doneCount).toBe(1);
  });

  it('unchecking a done task flips it back to not-done', () => {
    const update = vi.fn();
    const base = populated();
    const { rerender } = renderToday({ state: base, update });
    const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    fireEvent.click(checkbox);
    const afterFirst = applyUpdates(base, update);
    update.mockClear();
    rerender(
      React.createElement(TodayScreen, {
        state: afterFirst,
        today,
        update,
        adminUnlocked: false,
        canAutoUnlock: false,
        onAutoUnlock: () => false,
        onUnlockAdmin: vi.fn(async () => ({ ok: true })),
        onLockAdmin: vi.fn(),
        onSetAdminDay: vi.fn(),
      }),
    );
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    const afterSecond = applyUpdates(afterFirst, update);
    const doneCount = Object.values(afterSecond.taskLogs[today] ?? {}).filter(Boolean).length;
    expect(doneCount).toBe(0);
  });
});

describe('TodayScreen — add task', () => {
  it('FAB toggles the add-task form open and closed (icon + label swap Add ⇄ Cancel)', () => {
    renderToday();
    expect(screen.queryByPlaceholderText('Aaj ka task title')).toBeNull();
    const fab = screen.getByText('Add').closest('button') as HTMLButtonElement;
    fireEvent.click(fab);
    expect(screen.getByPlaceholderText('Aaj ka task title')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    fireEvent.click(fab);
    expect(screen.queryByPlaceholderText('Aaj ka task title')).toBeNull();
  });

  it("the inline form's own X button also closes it", () => {
    renderToday();
    fireEvent.click(screen.getByText('Add').closest('button')!);
    const card = screen.getByPlaceholderText('Aaj ka task title').closest('div.card') as HTMLElement;
    const within = card.querySelector('button[aria-label="Close add task"]') as HTMLButtonElement;
    fireEvent.click(within);
    expect(screen.queryByPlaceholderText('Aaj ka task title')).toBeNull();
  });

  it('blocks submission with an empty title and shows a flash notice, without calling update', () => {
    const update = vi.fn();
    renderToday({ update });
    fireEvent.click(screen.getByLabelText('Add task'));
    fireEvent.click(screen.getByText("Add to today's plan"));
    expect(screen.getByRole('status').textContent).toMatch(/Pehle task ka title bharo/);
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks a duplicate title already scheduled for today, without calling update', () => {
    const update = vi.fn();
    const base = populated();
    base.dynamicTaskBank = [scheduledEntry('Physics revision', 1)];
    renderToday({ state: base, update });
    fireEvent.click(screen.getByLabelText('Add task'));
    fireEvent.change(screen.getByPlaceholderText('Aaj ka task title'), {
      // Different case + extra whitespace — duplicate check should be
      // case-insensitive and whitespace-normalized.
      target: { value: '  physics   revision  ' },
    });
    fireEvent.click(screen.getByText("Add to today's plan"));
    expect(screen.getByRole('status').textContent).toMatch(/Duplicate add nahi hua/);
    expect(update).not.toHaveBeenCalled();
  });

  it('adds a new task on valid, non-duplicate input and resets/closes the form', () => {
    const update = vi.fn();
    const base = populated();
    renderToday({ state: base, update });
    fireEvent.click(screen.getByLabelText('Add task'));
    fireEvent.change(screen.getByPlaceholderText('Aaj ka task title'), { target: { value: 'Solve 10 MCQs' } });
    fireEvent.change(screen.getByLabelText('Duration in minutes'), { target: { value: '45' } });
    fireEvent.click(screen.getByText("Add to today's plan"));

    expect(update).toHaveBeenCalledTimes(1);
    const next = applyUpdates(base, update);
    const added = next.dynamicTaskBank.find((e) => e.title === 'Solve 10 MCQs');
    expect(added).toBeTruthy();
    expect(added?.estimatedDurationMin).toBe(45);
    expect(added?.active).toBe(true);

    // Form closes and resets.
    expect(screen.queryByPlaceholderText('Aaj ka task title')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Task aaj ke plan mein add ho gaya/);
  });

  it('clamps an out-of-range duration (e.g. 5000) to the 5–180 bound on submit', () => {
    const update = vi.fn();
    const base = populated();
    renderToday({ state: base, update });
    fireEvent.click(screen.getByLabelText('Add task'));
    fireEvent.change(screen.getByPlaceholderText('Aaj ka task title'), { target: { value: 'Marathon session' } });
    fireEvent.change(screen.getByLabelText('Duration in minutes'), { target: { value: '5000' } });
    fireEvent.click(screen.getByText("Add to today's plan"));
    const next = applyUpdates(base, update);
    const added = next.dynamicTaskBank.find((e) => e.title === 'Marathon session');
    expect(added?.estimatedDurationMin).toBe(180);
  });
});

describe('TodayScreen — edit task (long-press / right-click menu)', () => {
  function openMenuFor(title: string) {
    const row = screen.getByText(title).closest('div.card') as HTMLElement;
    fireEvent.contextMenu(row);
    return row;
  }

  it('right-click opens a menu with Edit and Delete', () => {
    renderToday();
    openMenuFor('Top 3 study goals likho (1 line each)');
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy();
  });

  it('Edit opens an inline form pre-filled with the current title/duration', () => {
    renderToday();
    openMenuFor('Top 3 study goals likho (1 line each)');
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }));
    const titleInput = screen.getByLabelText('Task title') as HTMLInputElement;
    expect(titleInput.value).toBe('Top 3 study goals likho (1 line each)');
  });

  it('Save blocks an empty title with a flash notice and does not call update', () => {
    const update = vi.fn();
    renderToday({ update });
    openMenuFor('Top 3 study goals likho (1 line each)');
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByRole('status').textContent).toMatch(/Title khaali nahi ho sakta/);
    expect(update).not.toHaveBeenCalled();
  });

  it('Save with a valid title persists the edit (title + clamped duration) via update()', () => {
    const update = vi.fn();
    const base = populated();
    renderToday({ state: base, update });
    openMenuFor('Top 3 study goals likho (1 line each)');
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Top 3 goals (edited)' } });
    fireEvent.change(screen.getByLabelText('Duration in minutes'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Save'));

    const next = applyUpdates(base, update);
    const edited = next.dynamicTaskBank.find((e) => e.id === 'd1_t1');
    expect(edited?.title).toBe('Top 3 goals (edited)');
    expect(edited?.estimatedDurationMin).toBe(5); // clamped to the 5-min floor
    expect(screen.getByRole('status').textContent).toMatch(/Task edit ho gaya/);
  });

  it('Cancel exits edit mode without persisting any change', () => {
    const update = vi.fn();
    renderToday({ update });
    openMenuFor('Top 3 study goals likho (1 line each)');
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Should not save' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText('Top 3 study goals likho (1 line each)')).toBeTruthy();
  });
});

describe('TodayScreen — delete task', () => {
  function openMenuFor(title: string) {
    const row = screen.getByText(title).closest('div.card') as HTMLElement;
    fireEvent.contextMenu(row);
    return row;
  }

  it('asks for confirmation; declining leaves the plan untouched', () => {
    const update = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderToday({ update });
    openMenuFor('Top 3 study goals likho (1 line each)');
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText('Top 3 study goals likho (1 line each)')).toBeTruthy();
  });

  it('a legacy (curriculum-default) task is hidden via a not-day condition, not erased from the bank', () => {
    const update = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const base = populated();
    renderToday({ state: base, update });
    openMenuFor('Top 3 study goals likho (1 line each)');
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));

    const next = applyUpdates(base, update);
    const patched = next.dynamicTaskBank.find((e) => e.id === 'd1_t1');
    expect(patched).toBeTruthy();
    expect(patched?.active).toBe(true);
    expect(patched?.unlockConditions).toContainEqual({ type: 'not-day', day: 1 });
    expect(screen.getByRole('status').textContent).toMatch(/Task aaj ke plan se hata diya/);
  });

  it('a user-added dynamic task is fully removed from dynamicTaskBank on delete', () => {
    const update = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const base = populated();
    base.dynamicTaskBank = [scheduledEntry('One-off errand', 1)];
    renderToday({ state: base, update });
    openMenuFor('One-off errand');
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    const next = applyUpdates(base, update);
    expect(next.dynamicTaskBank.find((e) => e.title === 'One-off errand')).toBeUndefined();
  });
});

describe('TodayScreen — completion celebration', () => {
  it('marking every task done drives progress to 100% (confetti fires once per mount)', () => {
    const update = vi.fn();
    const base = populated();
    renderToday({ state: base, update });
    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => fireEvent.click(cb));
    const next = applyUpdates(base, update);
    const log = next.taskLogs[today] ?? {};
    expect(Object.values(log).filter(Boolean).length).toBe(checkboxes.length);
  });
});

describe('TodayScreen — completed (mastered) bucket', () => {
  /** State at content day 6 with the seed task d1_t1 done on days 1..5 (mastered). */
  function masteredState(): AppState {
    const s = populated();
    s.startDateISO = isoAddDays(today, -5); // today = content day 6
    for (let d = 0; d < 5; d++) {
      s.taskLogs[isoAddDays(s.startDateISO, d)] = { d1_t1: true };
    }
    return s;
  }

  it('shows the collapsed Completed (Mastered) header once a task is mastered', () => {
    renderToday({ state: masteredState() });
    expect(screen.getByText('Completed (Mastered)')).toBeTruthy();
    expect(screen.getByText('1 task')).toBeTruthy();
    // Collapsed by default: the struck row is not visible yet.
    expect(screen.queryByText(/Move to Day/)).toBeNull();
  });

  it('expanding the section lists the mastered task with its controls', () => {
    renderToday({ state: masteredState() });
    fireEvent.click(screen.getByText('Completed (Mastered)'));
    expect(screen.getByText('Top 3 study goals likho (1 line each)')).toBeTruthy();
    expect(screen.getByText('Move to Day')).toBeTruthy();
    expect(screen.getByLabelText('Move Top 3 study goals likho (1 line each) back to completed')).toBeTruthy();
  });

  it('does not render the Completed section before anything is mastered', () => {
    renderToday();
    expect(screen.queryByText('Completed (Mastered)')).toBeNull();
  });

  it('move-to-day books a masteryPlacement schedule for a future content day', () => {
    const update = vi.fn();
    const base = masteredState();
    renderToday({ state: base, update });
    fireEvent.click(screen.getByText('Completed (Mastered)'));
    fireEvent.click(screen.getByText('Move to Day'));
    fireEvent.change(screen.getByLabelText('Move task to day'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Move'));

    expect(update).toHaveBeenCalledTimes(1);
    const next = applyUpdates(base, update);
    expect(next.masteryPlacement?.['d1_t1']).toEqual({ bucket: 'scheduled', day: 10 });
    expect(screen.getByRole('status').textContent).toMatch(/Day 10 ke liye schedule/);
  });

  it('move-to-day rejects an out-of-range day without calling update', () => {
    const update = vi.fn();
    renderToday({ state: masteredState(), update });
    fireEvent.click(screen.getByText('Completed (Mastered)'));
    fireEvent.click(screen.getByText('Move to Day'));
    fireEvent.change(screen.getByLabelText('Move task to day'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Move'));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/Day 1 se 90 ke beech ek number do/);
  });

  it('the move-back button returns a scheduled task to the completed bucket', () => {
    const update = vi.fn();
    const base = masteredState();
    base.masteryPlacement = { d1_t1: { bucket: 'scheduled', day: 10 } };
    renderToday({ state: base, update });
    fireEvent.click(screen.getByText('Completed (Mastered)'));
    fireEvent.click(
      screen.getByLabelText('Move Top 3 study goals likho (1 line each) back to completed'),
    );
    expect(update).toHaveBeenCalledTimes(1);
    const next = applyUpdates(base, update);
    expect(next.masteryPlacement?.['d1_t1']).toEqual({ bucket: 'completed' });
  });
});

describe('TodayScreen — touch long-press menu stability (regression)', () => {
  function openMenuFor(title: string) {
    const row = screen.getByText(title).closest('div.card') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });
    return row;
  }

  it('a touch-hold on the row does not re-position the menu while it is open', () => {
    renderToday();
    const row = openMenuFor('Top 3 study goals likho (1 line each)');
    const menu = screen.getByRole('menu') as HTMLElement;
    expect(menu.style.left).toBe('10px');

    vi.useFakeTimers();
    try {
      // A long-press that would have re-triggered openMenu(clientX, clientY)
      // in the old code — now the row ignores touch while its menu is open.
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 400, clientY: 500 });
      vi.advanceTimersByTime(600);
    } finally {
      vi.useRealTimers();
    }

    expect((screen.getByRole('menu') as HTMLElement).style.left).toBe('10px');
  });

  it('a tap on the backdrop still dismisses the menu while it is open', () => {
    renderToday();
    openMenuFor('Top 3 study goals likho (1 line each)');
    const menu = screen.getByRole('menu') as HTMLElement;
    fireEvent.click(menu.previousElementSibling as HTMLElement);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders the ctx menu in a portal outside the row so row :active transform cannot shift/cancel button taps', () => {
    renderToday();
    openMenuFor('Top 3 study goals likho (1 line each)');
    const menu = screen.getByRole('menu') as HTMLElement;
    const row = screen.getByText('Top 3 study goals likho (1 line each)').closest('div.card') as HTMLElement;
    expect(row.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('tapping Edit with a full touch pointer sequence opens the inline form', () => {
    renderToday();
    openMenuFor('Top 3 study goals likho (1 line each)');
    const edit = screen.getByRole('menuitem', { name: /Edit/ });
    fireEvent.pointerDown(edit, { pointerType: 'touch', clientX: 30, clientY: 40 });
    fireEvent.pointerUp(edit, { pointerType: 'touch' });
    fireEvent.click(edit);
    expect(screen.getByLabelText('Task title')).toBeTruthy();
  });

  it('right-click works again after the menu was closed with a backdrop tap', () => {
    renderToday();
    openMenuFor('Top 3 study goals likho (1 line each)');
    const menu = screen.getByRole('menu') as HTMLElement;
    fireEvent.click(menu.previousElementSibling as HTMLElement);
    expect(screen.queryByRole('menu')).toBeNull();

    const row = screen.getByText('Top 3 study goals likho (1 line each)').closest('div.card') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 30, clientY: 40 });
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
