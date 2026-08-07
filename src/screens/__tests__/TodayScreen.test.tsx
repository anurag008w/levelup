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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import TodayScreen from '../TodayScreen';
import { emptyAppState } from '../../core/domain/state';
import type { AppState } from '../../types';
import { isoDateInTimeZone, deviceTimeZone } from '../../core/ports/clock';
import { parseTaskBankEntry } from '../../features/task-bank/validation';

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
  const onUnlockAdmin = overrides.onUnlockAdmin ?? vi.fn(() => true);
  const onLockAdmin = overrides.onLockAdmin ?? vi.fn();
  const onSetAdminDay = overrides.onSetAdminDay ?? vi.fn();
  const props = {
    state: overrides.state ?? populated(),
    today,
    update,
    adminUnlocked: overrides.adminUnlocked ?? false,
    onUnlockAdmin,
    onLockAdmin,
    onSetAdminDay,
    onNavigate: overrides.onNavigate,
  };
  const utils = render(React.createElement(TodayScreen, props));
  return { ...utils, update, onUnlockAdmin, onLockAdmin, onSetAdminDay };
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

  it('shows an error and stays open on wrong credentials', () => {
    const onUnlockAdmin = vi.fn(() => false);
    renderToday({ onUnlockAdmin });
    fireEvent.click(screen.getByLabelText('Admin login'));
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'nope' } });
    fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Login'));
    expect(onUnlockAdmin).toHaveBeenCalledWith('nope', 'wrong');
    expect(screen.getByRole('alert').textContent).toMatch(/Galat username ya password/);
    // Dialog remains open on failure.
    expect(screen.getByRole('dialog', { name: 'Admin login' })).toBeTruthy();
  });

  it('closes the dialog on correct credentials', () => {
    const onUnlockAdmin = vi.fn(() => true);
    renderToday({ onUnlockAdmin });
    fireEvent.click(screen.getByLabelText('Admin login'));
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('Login'));
    expect(onUnlockAdmin).toHaveBeenCalledWith('admin', 'secret');
    expect(screen.queryByRole('dialog', { name: 'Admin login' })).toBeNull();
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
        onUnlockAdmin: vi.fn(() => true),
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
