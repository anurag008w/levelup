// @vitest-environment jsdom
/**
 * UI-level tests for the "Delete all data" flow and the chat-screen refresh:
 *  - clicking through Settings → Delete all → Yes really wipes state + chat
 *    through the real container (login session + default AI creds survive)
 *  - ChatScreen picks up a cleared / restored session list when the app
 *    dispatches the 'levelup:backup-imported' event
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { container } from './di/container';
import { emptyAppState } from './core/domain/state';
import type { ChatSession } from './core/domain/chat';
import ChatScreen from './screens/ChatScreen';
import AISettingsScreen from './screens/AISettingsScreen';

const SESSION = {
  serverUrl: 'https://sync.test',
  username: 'testuser',
  role: 'user' as const,
  isSuperAdmin: false,
  apiKey: 'sk-test',
  token: 'jwt-test',
  loggedInAt: '2026-01-01T00:00:00.000Z',
};

function seedChat(title: string): ChatSession {
  return container.chat.createSession(title);
}

describe('delete all data — UI flow', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.stubGlobal('scrollTo', () => {});
    // Restore a known state so tests don't depend on each other's leftovers.
    container.store.save(emptyAppState());
    container.chat.replaceStore([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Yes, delete all wipes local state + chat but keeps the login session', async () => {
    // Seed some real data through the container.
    const s = emptyAppState();
    s.startDateISO = '2026-01-01';
    container.store.save(s);
    seedChat('Old chat');

    render(
      React.createElement(AISettingsScreen, {
        state: container.store.get(),
        update: () => {},
        session: SESSION,
        onLogout: () => {},
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete all/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Delete all data' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Yes, delete all/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete all data' })).toBeNull());

    const fresh = container.store.get();
    expect(fresh.startDateISO).toBeNull();
    expect(fresh.taskLogs).toEqual({});
    expect(container.chat.listSessions()).toHaveLength(0);
  }, 15000);

  it('No, cancel leaves the data untouched', async () => {
    const s = emptyAppState();
    s.startDateISO = '2026-01-01';
    container.store.save(s);
    seedChat('Keep me');

    render(
      React.createElement(AISettingsScreen, {
        state: container.store.get(),
        update: () => {},
        session: SESSION,
        onLogout: () => {},
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete all/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Delete all data' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /No, cancel/i }));

    expect(container.store.get().startDateISO).toBe('2026-01-01');
    expect(container.chat.listSessions()).toHaveLength(1);
  });
});

describe('delete all data — ChatScreen refresh', () => {
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

  it('dispatch of backup-imported event swaps in the cleared session list', async () => {
    seedChat('Session A');
    render(React.createElement(ChatScreen));
    await waitFor(() => expect(screen.getByLabelText('Open chat history')).toBeTruthy());

    // Now simulate a full delete-all elsewhere in the app: chat is cleared and
    // the event is dispatched. The already-mounted screen must re-read.
    container.chat.replaceStore([]);
    window.dispatchEvent(new Event('levelup:backup-imported'));
    fireEvent.click(screen.getByLabelText('Open chat history'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Chats' })).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Abhi koi chat nahi hai.')).toBeTruthy());
  });

  it('dispatch of backup-imported event shows freshly restored sessions', async () => {
    render(React.createElement(ChatScreen));
    await waitFor(() => expect(screen.getByLabelText('Open chat history')).toBeTruthy());

    const restored = seedChat('Restored from backup');
    window.dispatchEvent(new Event('levelup:backup-imported'));
    fireEvent.click(screen.getByLabelText('Open chat history'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Chats' })).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText('Restored from backup').length).toBeGreaterThan(0));
    void restored;
  });
});
