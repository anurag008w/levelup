// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import App from './App';
import { container } from './di/container';
import { emptyAppState } from './core/domain/state';

describe('guest mode persistence', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.stubGlobal('scrollTo', () => {});
    container.store.save(emptyAppState());
    container.chat.replaceStore([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skipping login persists guest mode across refresh', async () => {
    // First launch: no session, no guest flag → login gate shows.
    render(React.createElement(App));
    await waitFor(() => expect(screen.getByText(/Skip — offline mode me chalein/i)).toBeTruthy());

    // Enter guest mode.
    fireEvent.click(screen.getByText(/Skip — offline mode me chalein/i));
    await waitFor(() => expect(screen.queryByText(/Skip — offline mode me chalein/i)).toBeNull());
    expect(localStorage.getItem('levelup:guest')).toBe('true');

    // "Refresh" = unmount + remount.
    cleanup();
    render(React.createElement(App));
    await waitFor(() => expect(screen.queryByText(/Skip — offline mode me chalein/i)).toBeNull());
  });

  it('logout clears the guest flag so login gate returns', async () => {
    localStorage.setItem('levelup:guest', 'true');
    render(React.createElement(App));
    await waitFor(() => expect(screen.queryByText(/Skip — offline mode me chalein/i)).toBeNull());

    cleanup();
    localStorage.removeItem('levelup:guest');
    render(React.createElement(App));
    await waitFor(() => expect(screen.getByText(/Skip — offline mode me chalein/i)).toBeTruthy());
  });
});

describe('account isolation', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.stubGlobal('scrollTo', () => {});
    container.store.save(emptyAppState());
    container.chat.replaceStore([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('entering guest mode after an account wipes that account local data', async () => {
    // An account (alice) previously used this device and left data behind.
    localStorage.setItem('levelup.data-owner', 'alice');
    const s = emptyAppState();
    s.startDateISO = '2026-01-01';
    container.store.save(s);
    container.chat.createSession('alice ka chat');

    render(React.createElement(App));
    await waitFor(() => expect(screen.getByText(/Skip — offline mode me chalein/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/Skip — offline mode me chalein/i));
    await waitFor(() => expect(screen.queryByText(/Skip — offline mode me chalein/i)).toBeNull());

    // alice's state + chat must not be visible to the guest.
    expect(container.store.get().startDateISO).toBeNull();
    expect(container.chat.listSessions()).toHaveLength(0);
    expect(localStorage.getItem('levelup.data-owner')).toBe('guest');
  });

  it('guest mode preserves its own local data across guest sessions', async () => {
    localStorage.setItem('levelup.data-owner', 'guest');
    const s = emptyAppState();
    s.startDateISO = '2026-01-01';
    container.store.save(s);
    container.chat.createSession('guest ka chat');

    render(React.createElement(App));
    await waitFor(() => expect(screen.getByText(/Skip — offline mode me chalein/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/Skip — offline mode me chalein/i));
    await waitFor(() => expect(screen.queryByText(/Skip — offline mode me chalein/i)).toBeNull());

    expect(container.store.get().startDateISO).toBe('2026-01-01');
    expect(container.chat.listSessions()).toHaveLength(1);
  });
});
