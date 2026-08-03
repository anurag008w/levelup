// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { container } from './di/container';
import { emptyAppState } from './core/domain/state';
import { isoDateInTimeZone, deviceTimeZone } from './core/ports/clock';
import TodayScreen from './screens/TodayScreen';
import ProgressScreen from './screens/ProgressScreen';
import LevelsScreen from './screens/LevelsScreen';
import ReviewScreen from './screens/ReviewScreen';
import TaskBankScreen from './screens/TaskBankScreen';
import PostJourneyScreen from './screens/PostJourneyScreen';

const noop = () => {};
const unlockAdmin = (_username: string, _password: string) => true;
const today = isoDateInTimeZone(new Date(), deviceTimeZone());

function populated(): ReturnType<typeof emptyAppState> {
  const s = emptyAppState();
  s.startDateISO = today;
  s.timeZone = deviceTimeZone();
  return s;
}

describe('screen smoke tests', () => {
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

  it('TodayScreen shows mission-start before the journey begins', () => {
    render(React.createElement(TodayScreen, { state: emptyAppState(), today, update: noop, adminUnlocked: false, onUnlockAdmin: unlockAdmin, onLockAdmin: noop, onSetAdminDay: noop }));
    expect(screen.getByText(/Mission Start — Day 1/)).toBeTruthy();
  });

  it('TodayScreen renders the active day once the journey starts', () => {
    render(React.createElement(TodayScreen, { state: populated(), today, update: noop, adminUnlocked: false, onUnlockAdmin: unlockAdmin, onLockAdmin: noop, onSetAdminDay: noop }));
    expect(screen.getByText(/CASE — DAY 001/)).toBeTruthy();
  });

  it('ProgressScreen renders its empty state pre-journey', () => {
    render(React.createElement(ProgressScreen, { state: emptyAppState(), today }));
    expect(screen.getByText('Mission shuru nahi hua')).toBeTruthy();
  });

  it('LevelsScreen renders level content on day 1', () => {
    render(React.createElement(LevelsScreen, { state: populated(), today, update: noop }));
    expect(screen.getByText('Daily Tasks')).toBeTruthy();
  });

  it('ReviewScreen renders empty review state', () => {
    render(React.createElement(ReviewScreen, { state: emptyAppState(), today, update: noop, resetAll: noop }));
    expect(screen.getByText('Mission shuru nahi hua')).toBeTruthy();
  });

  it('TaskBankScreen renders the task list header', () => {
    render(React.createElement(TaskBankScreen, { state: emptyAppState(), update: noop }));
    expect(screen.getByText('TASK BANK')).toBeTruthy();
  });

  it('PostJourneyScreen renders custom blocks section', () => {
    render(React.createElement(PostJourneyScreen, { state: populated(), update: noop, onBack: noop }));
    expect(screen.getByText('Custom blocks & mastery levels')).toBeTruthy();
  });
});
