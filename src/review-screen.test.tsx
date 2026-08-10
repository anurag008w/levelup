// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { container } from './di/container';
import { emptyAppState } from './core/domain/state';
import { deviceTimeZone } from './core/ports/clock';
import ReviewScreen from './screens/ReviewScreen';

const noop = () => {};

function journey(startISO: string) {
  const s = emptyAppState();
  s.startDateISO = startISO;
  s.timeZone = deviceTimeZone();
  return s;
}

describe('ReviewScreen exam banner states', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
    vi.stubGlobal('scrollTo', () => {});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  it('shows a neutral countdown when the exam is set but more than 30 days out', () => {
    const s = journey('2026-01-01');
    s.examDateISO = '2026-07-01'; // ~181 days out — NOT exam month yet
    render(React.createElement(ReviewScreen, { state: s, today: '2026-01-01', update: noop, resetAll: noop }));
    expect(screen.queryByText('Exam Month Active')).toBeNull();
    expect(screen.getByText(/JEE Main tak 181 din\. Exam Month mode 30 din pehle auto-activate hoga\./)).toBeTruthy();
  });

  it('shows the active hero only inside the 30-day window', () => {
    const s = journey('2026-01-01');
    s.examDateISO = '2026-02-01'; // 17 days out — active
    render(React.createElement(ReviewScreen, { state: s, today: '2026-01-15', update: noop, resetAll: noop }));
    expect(screen.getByText('Exam Month Active')).toBeTruthy();
    expect(screen.getByText(/Today screen ab revision-only mode mein hai\./)).toBeTruthy();
  });

  it('shows a passed state instead of a negative countdown after the exam', () => {
    const s = journey('2026-01-01');
    s.examDateISO = '2025-12-01'; // 31 days in the past
    render(React.createElement(ReviewScreen, { state: s, today: '2026-01-01', update: noop, resetAll: noop }));
    expect(screen.queryByText('Exam Month Active')).toBeNull();
    expect(screen.getByText(/guzar chuka hai/)).toBeTruthy();
  });
});

describe('ReviewScreen review catch-up', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
    vi.stubGlobal('scrollTo', () => {});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  it('offers the missed week review (earliest pending) after the due day passes', () => {
    const s = journey('2026-01-01');
    // Day 9: week 1's deadline (day 7) passed unreviewed → week 1 review offered
    // (both the Upcoming row and the form card name the pending week).
    render(React.createElement(ReviewScreen, { state: s, today: '2026-01-09', update: noop, resetAll: noop }));
    expect(screen.getAllByText(/Weekly Review — Week 1/).length).toBeGreaterThan(0);
    expect(screen.getByText('Weekly Review Save Karo')).toBeTruthy();
  });

  it('saves the catch-up review with the pending week number, not the current week', () => {
    const s = journey('2026-01-01');
    let applied: typeof s | null = null;
    const update = (fn: (prev: typeof s) => typeof s) => {
      applied = fn(s);
    };
    render(React.createElement(ReviewScreen, { state: s, today: '2026-01-09', update, resetAll: noop }));
    const card = screen.getByText('Weekly Review Save Karo').closest('.card') as HTMLElement;
    const inputs = card.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'Physics' } });
    fireEvent.click(screen.getByText('Weekly Review Save Karo'));
    expect(applied).not.toBeNull();
    expect(applied!.weeklyReviews).toHaveLength(1);
    expect(applied!.weeklyReviews[0].weekNumber).toBe(1); // pending week, not week 2
    expect(applied!.weeklyReviews[0].strongest).toBe('Physics');
  });
});
