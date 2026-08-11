// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { container } from './di/container';
import ChatScreen from './screens/ChatScreen';
import AISettingsScreen from './screens/AISettingsScreen';

describe('settings open smoke', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    try { container.chat.createSession(''); } catch {}
    vi.stubGlobal('scrollTo', () => {});
  });

  it('ChatScreen model settings + chat settings buttons open the sheet', async () => {
    render(React.createElement(ChatScreen));
    await waitFor(() => expect(screen.getByLabelText('Model settings')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Model settings'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Chat settings' })).toBeTruthy());
    // close and reopen via the ⋯ button
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chat settings' })).toBeNull());
    fireEvent.click(screen.getByLabelText('Chat settings'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Chat settings' })).toBeTruthy());
  });

  it('AISettingsScreen Chat Experience opens ChatSettingsScreen', async () => {
    render(React.createElement(AISettingsScreen, { state: container.store.get(), update: () => {}, session: null, onLogout: () => {} }));
    const btn = screen.getByText('Chat Experience');
    fireEvent.click(btn);
    // Generous timeout: this waitFor has historically flaked under parallel
    // worker load (N4 class — documented in docs/misa_ai_bug_audit.md §10),
    // where the default 1s budget is too tight for a full 87-file run.
    await waitFor(() => expect(screen.getByText('Response Quality')).toBeTruthy(), { timeout: 15000 });
  });

  it('AISettingsScreen Delete all data shows a Yes/No confirm dialog', async () => {
    const session = {
      serverUrl: 'https://sync.test',
      username: 'testuser',
      role: 'user' as const,
      isSuperAdmin: false,
      apiKey: 'sk-test',
      token: 'jwt-test',
      loggedInAt: '2026-01-01T00:00:00.000Z',
    };
    render(
      React.createElement(AISettingsScreen, {
        state: container.store.get(),
        update: () => {},
        session,
        onLogout: () => {},
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Delete all/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Delete all data' })).toBeTruthy());
    // Yes and No are both present.
    expect(screen.getByRole('button', { name: /Yes, delete all/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /No, cancel/i })).toBeTruthy();
  });
});
