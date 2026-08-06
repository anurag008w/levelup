// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, notifyAiReplyMock, onActionHandlerMock, minimizeAppMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  notifyAiReplyMock: vi.fn(),
  onActionHandlerMock: vi.fn(),
  minimizeAppMock: vi.fn(),
}));

vi.mock('../../di/container', () => ({
  container: {
    chat: { send: (...args: unknown[]) => sendMock(...args) },
  },
}));

vi.mock('@capacitor/app', () => ({
  App: { minimizeApp: (...args: unknown[]) => minimizeAppMock(...args) },
}));

vi.mock('../notifications', () => ({
  notifyAiReply: (...args: unknown[]) => notifyAiReplyMock(...args),
  registerNotificationActions: async () => {},
  trackAppState: () => {},
  isNativePlatform: () => true,
  onNotificationAction: (handler: unknown) => {
    onActionHandlerMock(handler);
    return Promise.resolve(() => {});
  },
}));

import { setupNotificationActions } from '../notification-actions';

type ActionHandler = (action: { actionId: string; inputValue?: string; sessionId?: string }) => void;

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe('notification-actions', () => {
  let handler: ActionHandler | null = null;

  beforeEach(() => {
    sendMock.mockReset();
    notifyAiReplyMock.mockReset();
    minimizeAppMock.mockReset();
    onActionHandlerMock.mockImplementation((h: ActionHandler) => {
      handler = h;
    });
    setupNotificationActions();
  });

  it('sends an inline reply without opening the chat app, then minimizes back down', async () => {
    sendMock.mockResolvedValue({ content: 'AI reply text' });
    const openChat = vi.fn();
    const chatUpdated = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);
    window.addEventListener('levelup:chat-updated', chatUpdated);

    await handler!({ actionId: 'reply', inputValue: '  hello  ', sessionId: 's1' });
    await flush();

    expect(sendMock).toHaveBeenCalledWith('s1', 'hello');
    // Reply notification ab chat UI jaisa reveal schedule use karti hai:
    // single bubble → 3000ms thinking delay (not 0/turant).
    expect(notifyAiReplyMock).toHaveBeenCalledWith('Misa', 'AI reply text', 's1', 3000, true);
    expect(openChat).not.toHaveBeenCalled();
    expect(chatUpdated).toHaveBeenCalled();
    // Turant minimize (screen kam time ke liye khule) + finally mein double safety.
    expect(minimizeAppMock).toHaveBeenCalledTimes(2);
  });

  it('uses the full reveal delay for multi-bubble replies (delayed, not instant)', async () => {
    sendMock.mockResolvedValue({ content: 'Pehla paragraph.\n\nDusra paragraph.' });
    await handler!({ actionId: 'reply', inputValue: 'hello again', sessionId: 's1' });
    await flush();

    expect(notifyAiReplyMock).toHaveBeenCalledTimes(1);
    const [title, body, sessionId, delayMs, force] = notifyAiReplyMock.mock.calls[0];
    expect(title).toBe('Misa');
    expect(body).toBe('Pehla paragraph.\n\nDusra paragraph.');
    expect(sessionId).toBe('s1');
    // firstDelay (3000) + 3–8s gap → definitely above the single-bubble delay.
    expect(delayMs).toBeGreaterThan(3000);
    expect(force).toBe(true);
  });

  it('still minimizes and cleans up even if the reply send fails', async () => {
    sendMock.mockRejectedValue(new Error('AI off'));
    const chatUpdated = vi.fn();
    window.addEventListener('levelup:chat-updated', chatUpdated);

    await handler!({ actionId: 'reply', inputValue: 'dusra message', sessionId: 's1' });
    await flush();

    expect(notifyAiReplyMock).not.toHaveBeenCalled();
    expect(chatUpdated).toHaveBeenCalled();
    // Turant minimize + finally cleanup — dono.
    expect(minimizeAppMock).toHaveBeenCalledTimes(2);
  });

  it('opens the chat when the user taps an "open" action', async () => {
    const openChat = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);

    await handler!({ actionId: 'open', sessionId: 's1' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(openChat).toHaveBeenCalled();
  });

  it('sends a duplicate reply (persist flush + activity intent) only once', async () => {
    sendMock.mockResolvedValue({ content: 'AI reply text' });
    // Cold-start fallback me same reply 2 baar aa sakta hai — dono events ka
    // sessionId + inputValue same hota hai. Sirf pehla send hona chahiye.
    await handler!({ actionId: 'reply', inputValue: 'duplicate check', sessionId: 's1' });
    await handler!({ actionId: 'reply', inputValue: 'duplicate check', sessionId: 's1' });
    await flush();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(notifyAiReplyMock).toHaveBeenCalledTimes(1);
  });
});
