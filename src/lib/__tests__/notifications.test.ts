// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scheduleMock, checkPermissionsMock, createChannelMock } = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  checkPermissionsMock: vi.fn(),
  createChannelMock: vi.fn(),
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
    createChannel: (args: unknown) => createChannelMock(args),
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
  LIVE_CHANNEL_ID,
} from '../notifications';
import { container } from '../../di/container';

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
    createChannelMock.mockReset();
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

  it('force bypasses chat-tab suppression — notification-reply flow, where the reply Activity resuming makes chatTabActive+appActive look identical to "user is watching" even though they are not', async () => {
    await setNotificationPreference(true);
    setChatTabActive(true);
    await notifyAiReply('Misa', 'reply', 'session-1', 0, true);
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
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

  it('schedules a delayed reply notification at the OS level when force=true even if the app still reads as active (reply flow minimizes right after)', async () => {
    await setNotificationPreference(true);
    setChatTabActive(true);
    // Reply action Activity ko resume kar deta hai, isliye appActive abhi bhi
    // "true" dikh sakta hai — but force=true means the user is definitely NOT
    // watching (they replied from the notification shade), and the app is
    // minimized right after send. JS setTimeout delivery can't be trusted then,
    // so the reply notification MUST go to OS-level schedule.at.
    setAppHidden(false);
    const before = Date.now();
    await notifyAiReply('Misa', 'reply body', 'session-1', 3000, true);
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const scheduled = scheduleMock.mock.calls[0][0].notifications[0];
    expect(scheduled.schedule.at.getTime()).toBeGreaterThanOrEqual(before + 3000);
    expect(scheduled.schedule.allowWhileIdle).toBe(true);
  });

  it('shows the latest bubble as collapsed body while largeBody holds the full merged reply', async () => {
    await setNotificationPreference(true);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'Dusra', 'session-1', 0, true, 'Pehla\n\nDusra');
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.body).toBe('Dusra');
    expect(n.largeBody).toBe('Pehla\n\nDusra');
  });

  it('passes the conversation to native MessagingStyle via extra.messages when bubbles are given', async () => {
    await setNotificationPreference(true);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'Dusra', 'session-1', 0, true, 'Pehla\n\nDusra', [
      { text: 'Pehla', at: 1000 },
      { text: 'Dusra', at: 2000 },
    ]);
    await flush();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.extra).toEqual({
      sessionId: 'session-1',
      messages: [
        { text: 'Pehla', at: 1000, sender: 'ai' },
        { text: 'Dusra', at: 2000, sender: 'ai' },
      ],
    });
  });

  it('tags the MessagingStyle owner with the app username (not the AI name)', async () => {
    localStorage.setItem(
      'levelup.auth.session',
      JSON.stringify({ serverUrl: 'https://x', apiKey: 'k', username: 'Anurag', role: 'user', token: 't', loggedInAt: 'now' }),
    );
    await setNotificationPreference(true);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'Dusra', 'session-1', 0, true, 'Pehla\n\nDusra', [
      { text: 'Mera reply', at: 900, sender: 'user' },
      { text: 'Pehla', at: 1000 },
    ]);
    await flush();
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.extra.userName).toBe('Anurag');
    expect(n.extra.messages).toEqual([
      { text: 'Mera reply', at: 900, sender: 'user' },
      { text: 'Pehla', at: 1000, sender: 'ai' },
    ]);
  });

  it('falls back to the Settings > Profile name when logged out', async () => {
    const state = container.store.get();
    container.store.save({ ...state, userProfile: { ...state.userProfile, name: 'Ravi' } });
    await setNotificationPreference(true);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'Dusra', 'session-1', 0, true, 'Pehla\n\nDusra', [{ text: 'Pehla', at: 1000 }]);
    await flush();
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.extra.userName).toBe('Ravi');
  });

  it('keeps the extra payload unchanged when no bubbles are given (existing behavior untouched)', async () => {
    await setNotificationPreference(true);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'reply', 'session-1', 0, true, 'full reply');
    await flush();
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.extra).toEqual({ sessionId: 'session-1' });
  });

  it('keeps foreground delayed notifications on JS timers when force is NOT set (normal chat reveal flow)', async () => {
    await setNotificationPreference(true);
    setChatTabActive(true);
    setAppHidden(false);
    await notifyAiReply('Misa', 'bubble text', 'session-1', 3000);
    await flush();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('does nothing when the notification preference is off', async () => {
    await setNotificationPreference(false);
    setChatTabActive(false);
    await notifyAiReply('Misa', 'reply', 'session-1');
    await flush();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('live-call chat reply still notifies on a SILENT channel while the app is foreground + chat tab active (no popup, but it always arrives)', async () => {
    // Real-device report: durante a live call the chat notification never came.
    // Root cause hypothesis: the app "thinks" it's foreground (appActive true)
    // so the normal skip lambda stops it. The live overlay forces through with
    // force=true, but it ALSO must land on a LOW-importance SILENT channel so it
    // arrives in the drawer without popping up over the call (user request:
    // "silent wali aaye, popup ke bina, foreground ho ya background").
    await setNotificationPreference(true);
    setChatTabActive(true);
    setAppHidden(false); // app genuinely foreground, exactly the reported case

    await notifyAiReply('Misa Live', 'reply', 'live', 0, true, 'reply', [{ text: 'reply', at: 1 }], {
      channelId: LIVE_CHANNEL_ID,
    });
    await flush();

    // It MUST NOT be suppressed by the foreground+chatTabActive check.
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.channelId).toBe(LIVE_CHANNEL_ID);

    // The silent channel is created with LOW importance (no popup/sound).
    const ch = createChannelMock.mock.calls.map((c) => c[0]).find((c: any) => c.id === LIVE_CHANNEL_ID);
    expect(ch).toBeDefined();
    expect(ch.importance).toBe(2);
  });

  it('falls back to the HIGH channel when the silent LIVE channel can NOT be ensured — the live reply is still delivered, never dropped', async () => {
    // OEM/channel failure: creating the silent channel throws. The code must
    // fall back to the default HIGH channel and STILL schedule the live reply,
    // instead of leaving it on a channel that does not exist (silent drop).
    await setNotificationPreference(true);
    setChatTabActive(true);
    setAppHidden(false);
    createChannelMock.mockImplementation(() => {
      throw new Error('channel create failed');
    });

    await notifyAiReply('Misa Live', 'reply', 'live', 0, true, 'reply', [{ text: 'reply', at: 1 }], {
      channelId: LIVE_CHANNEL_ID,
    });
    await flush();

    // Still delivered once — but on the default HIGH channel fallback.
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const n = scheduleMock.mock.calls[0][0].notifications[0];
    expect(n.channelId).toBe('levelup-ai-replies');
  });
});
