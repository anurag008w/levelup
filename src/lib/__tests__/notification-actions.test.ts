// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { REPLY_GRACE_MS, setupNotificationActions } from '../notification-actions';

type ActionHandler = (action: { actionId: string; inputValue?: string; sessionId?: string }) => void;

describe('notification-actions', () => {
  let handler: ActionHandler | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMock.mockReset();
    notifyAiReplyMock.mockReset();
    minimizeAppMock.mockReset();
    onActionHandlerMock.mockImplementation((h: ActionHandler) => {
      handler = h;
    });
    setupNotificationActions();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an inline reply without opening the chat, minimizes ~1s, then reveals the bubble like chat', async () => {
    sendMock.mockResolvedValue({ content: 'AI reply text' });
    const openChat = vi.fn();
    const chatUpdated = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);
    window.addEventListener('levelup:chat-updated', chatUpdated);

    handler!({ actionId: 'reply', inputValue: '  hello  ', sessionId: 's1' });

    expect(sendMock).toHaveBeenCalledWith('s1', 'hello');
    expect(minimizeAppMock).not.toHaveBeenCalled();
    // Minimize ~1s ke andar — send complete hone ka wait nahi karta.
    await vi.advanceTimersByTimeAsync(REPLY_GRACE_MS);
    expect(minimizeAppMock).toHaveBeenCalledTimes(1);
    expect(notifyAiReplyMock).not.toHaveBeenCalled();
    // Pehla bubble 3s thinking pause ke baad (chat jaisa reveal).
    await vi.advanceTimersByTimeAsync(3000);
    // Fire-time bubble (delayMs=0) + force=true — same id turant merge hota hai.
    // Body = latest bubble, largeBody (6th arg) = cumulative text, messages
    // (7th arg) = native MessagingStyle conversation — user ka reply pehle,
    // phir Misa ka bubble.
    expect(notifyAiReplyMock).toHaveBeenCalledWith('Misa', 'AI reply text', 's1', 0, true, 'AI reply text', [
      { text: 'hello', at: expect.any(Number), sender: 'user' },
      { text: 'AI reply text', at: expect.any(Number), sender: 'ai' },
    ]);
    expect(openChat).not.toHaveBeenCalled();
    expect(chatUpdated).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledBefore(minimizeAppMock);
  });

  it('reveals multi-bubble replies bubble-by-bubble exactly like chat (fire-time merge, not OS pre-schedule)', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    sendMock.mockResolvedValue({ content: 'Pehla paragraph.\n\nDusra paragraph.' });
    handler!({ actionId: 'reply', inputValue: 'hello again', sessionId: 's1' });

    // Pehla bubble 3000ms pe (thinking pause).
    await vi.advanceTimersByTimeAsync(REPLY_GRACE_MS + 3000);
    expect(notifyAiReplyMock).toHaveBeenCalledTimes(1);
    const first = notifyAiReplyMock.mock.calls[0];
    expect(first[0]).toBe('Misa');
    // Body = LATEST bubble (collapsed/heads-up), not the first one.
    expect(first[1]).toBe('Pehla paragraph.');
    expect(first[2]).toBe('s1');
    expect(first[3]).toBe(0);
    expect(first[4]).toBe(true);
    expect(first[5]).toBe('Pehla paragraph.');
    expect(first[6]).toEqual([
      { text: 'hello again', at: expect.any(Number), sender: 'user' },
      { text: 'Pehla paragraph.', at: expect.any(Number), sender: 'ai' },
    ]);
    // Gap (Math.random=0 → exactly 3000ms) ke baad second bubble.
    await vi.advanceTimersByTimeAsync(3000);
    expect(notifyAiReplyMock).toHaveBeenCalledTimes(2);
    const last = notifyAiReplyMock.mock.calls[1];
    // Body ab LATEST bubble hai (pehla nahi), largeBody = poora reply, messages
    // = poora conversation so far (MessagingStyle).
    expect(last[1]).toBe('Dusra paragraph.');
    expect(last[3]).toBe(0);
    expect(last[4]).toBe(true);
    expect(last[5]).toBe('Pehla paragraph.\n\nDusra paragraph.');
    expect(last[6]).toEqual([
      { text: 'hello again', at: expect.any(Number), sender: 'user' },
      { text: 'Pehla paragraph.', at: expect.any(Number), sender: 'ai' },
      { text: 'Dusra paragraph.', at: expect.any(Number), sender: 'ai' },
    ]);
    randomSpy.mockRestore();
  });

  it('fires an immediate notification for an empty/whitespace reply', async () => {
    sendMock.mockResolvedValue({ content: '   ' });
    handler!({ actionId: 'reply', inputValue: 'whitespace check', sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(REPLY_GRACE_MS);

    expect(minimizeAppMock).toHaveBeenCalledTimes(1);
    expect(notifyAiReplyMock).toHaveBeenCalledWith('Misa', 'Naya AI reply aaya', 's1', 0, true);
  });

  it('still minimizes even if the reply send fails, and surfaces the error instead of silently dropping', async () => {
    sendMock.mockRejectedValue(new Error('AI off'));
    const chatUpdated = vi.fn();
    window.addEventListener('levelup:chat-updated', chatUpdated);

    handler!({ actionId: 'reply', inputValue: 'dusra message', sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(REPLY_GRACE_MS);

    expect(minimizeAppMock).toHaveBeenCalledTimes(1);
    // Silently drop mat karo — user ko error notification ke through batao
    // reply nahi gaya taaki wo chat khol kar dobara bole.
    expect(notifyAiReplyMock).toHaveBeenCalledTimes(1);
    expect(notifyAiReplyMock).toHaveBeenCalledWith(
      'Misa',
      expect.stringContaining('Reply bhejne me dikkat aayi'),
      's1',
      0,
      true,
    );
    expect(chatUpdated).toHaveBeenCalled();
  });

  it('opens the chat when the user taps an "open" action', async () => {
    const openChat = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);

    handler!({ actionId: 'open', sessionId: 's1' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(openChat).toHaveBeenCalled();
  });

  it('sends a duplicate reply (persist flush + activity intent) only once', async () => {
    sendMock.mockResolvedValue({ content: 'AI reply text' });
    // Cold-start fallback me same reply 2 baar aa sakta hai — dono events ka
    // sessionId + inputValue same hota hai. Sirf pehla send hona chahiye.
    handler!({ actionId: 'reply', inputValue: 'duplicate check', sessionId: 's1' });
    handler!({ actionId: 'reply', inputValue: 'duplicate check', sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(REPLY_GRACE_MS + 3000);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(notifyAiReplyMock).toHaveBeenCalledTimes(1);
  });
});
