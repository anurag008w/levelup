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
    await waitFor(() => expect(screen.getByText('Response Quality')).toBeTruthy());
  });
});
