// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scheduleMock, checkPermissionsMock } = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  checkPermissionsMock: vi.fn(),
}));

const nativePlatform = vi.hoisted(() => ({ value: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativePlatform.value },
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: async () => ({ remove: async () => {} }) },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: () => checkPermissionsMock(),
    schedule: (args: unknown) => scheduleMock(args),
    listChannels: async () => ({ channels: [] }),
    createChannel: async () => {},
    registerActionTypes: async () => {},
    addListener: async () => ({ remove: async () => {} }),
  },
}));

vi.mock('@capgo/capacitor-intent-launcher', () => ({
  IntentLauncher: { startActivityAsync: async () => {} },
  ActivityAction: { APP_NOTIFICATION_SETTINGS: 'x', APPLICATION_DETAILS_SETTINGS: 'y' },
}));

import {
  isAppActive,
  isChatTabActive,
  notifyAiReply,
  setChatTabActive,
  setNotificationPreference,
  trackAppState,
} from '../notifications';

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

/** Sets the page visibility AND re-syncs the app-active tracker. */
function setAppHidden(hidden: boolean): void {
  setDocumentHidden(hidden);
  trackAppState();
}

/** notifyAiReply fires the actual notification asynchronously (void fire()). */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe('notifications — chat-tab suppression', () => {
  beforeEach(() => {
    nativePlatform.value = true;
    setChatTabActive(false);
    setAppHidden(false);
    scheduleMock.mockReset();
    checkPermissionsMock.mockReset();
    checkPermissionsMock.mockResolvedValue({ display: 'granted' });
    localStorage.clear();
  });

  it('tracks the chat-tab-active flag', () => {
    expect(isChatTabActive()).toBe(false);
    setChatTabActive(true);
    expect(isChatTabActive()).toBe(true);
    setChatTabActive(false);
    expect(isChatTabActive()).toBe(false);
  });

  it('tracks app foreground/background state', () => {
    expect(isAppActive()).toBe(true);
    setAppHidden(true);
    expect(isAppActive()).toBe(false);
    setAppHidden(false);
    expect(isAppActive()).toBe(true);
  });

  it('suppresses AI-reply notifications while the chat tab is active and visible', async () => {
    await setNotificationPreference(true);
    setChatTabActive(true);
    await notifyAiReply('Misa', 'reply', 'session-1');
    await flush();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('sends the notification when the chat tab is NOT active', async () => {
    await setNotificationPreference(true);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'reply', 'session-1');
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('sends the notification when the app is backgrounded even if the chat tab is active', async () => {
    await setNotificationPreference(true);
    setChatTabActive(true);
    setAppHidden(true);
    await notifyAiReply('Misa', 'reply', 'session-1');
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('schedules delayed notifications at the OS level while backgrounded', async () => {
    await setNotificationPreference(true);
    setChatTabActive(true);
    setAppHidden(true);
    const before = Date.now();
    await notifyAiReply('Misa', 'full reply', 'session-1', 5000);
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const scheduled = scheduleMock.mock.calls[0][0].notifications[0];
    expect(scheduled.schedule.at.getTime()).toBeGreaterThanOrEqual(before + 5000);
    expect(scheduled.schedule.allowWhileIdle).toBe(true);
  });

  it('does nothing when the notification preference is off', async () => {
    await setNotificationPreference(false);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'reply', 'session-1');
    await flush();
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});
