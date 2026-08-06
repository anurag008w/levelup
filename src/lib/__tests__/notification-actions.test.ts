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
    expect(notifyAiReplyMock).toHaveBeenCalledWith('Misa', 'AI reply text', 's1', 0, true);
    expect(openChat).not.toHaveBeenCalled();
    expect(chatUpdated).toHaveBeenCalled();
    expect(minimizeAppMock).toHaveBeenCalled();
  });

  it('still minimizes and cleans up even if the reply send fails', async () => {
    sendMock.mockRejectedValue(new Error('AI off'));
    const chatUpdated = vi.fn();
    window.addEventListener('levelup:chat-updated', chatUpdated);

    await handler!({ actionId: 'reply', inputValue: 'hello', sessionId: 's1' });
    await flush();

    expect(notifyAiReplyMock).not.toHaveBeenCalled();
    expect(chatUpdated).toHaveBeenCalled();
    expect(minimizeAppMock).toHaveBeenCalled();
  });

  it('opens the chat when the user taps an "open" action', async () => {
    const openChat = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);

    await handler!({ actionId: 'open', sessionId: 's1' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(openChat).toHaveBeenCalled();
  });
});
