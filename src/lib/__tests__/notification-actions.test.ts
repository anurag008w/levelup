// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, notifyAiReplyMock, onActionHandlerMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  notifyAiReplyMock: vi.fn(),
  onActionHandlerMock: vi.fn(),
}));

vi.mock('../../di/container', () => ({
  container: {
    chat: { send: (...args: unknown[]) => sendMock(...args) },
  },
}));

vi.mock('../notifications', () => ({
  notifyAiReply: (...args: unknown[]) => notifyAiReplyMock(...args),
  registerNotificationActions: async () => {},
  trackAppState: () => {},
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
    onActionHandlerMock.mockImplementation((h: ActionHandler) => {
      handler = h;
    });
    setupNotificationActions();
  });

  it('sends an inline reply without opening the chat app', async () => {
    sendMock.mockResolvedValue({ content: 'AI reply text' });
    const openChat = vi.fn();
    const chatUpdated = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);
    window.addEventListener('levelup:chat-updated', chatUpdated);

    await handler!({ actionId: 'reply', inputValue: '  hello  ', sessionId: 's1' });
    await flush();

    expect(sendMock).toHaveBeenCalledWith('s1', 'hello');
    expect(notifyAiReplyMock).toHaveBeenCalledWith('Misa', 'AI reply text', 's1');
    expect(openChat).not.toHaveBeenCalled();
    expect(chatUpdated).toHaveBeenCalled();
  });

  it('opens the chat when the user taps an "open" action', async () => {
    const openChat = vi.fn();
    window.addEventListener('levelup:open-chat', openChat);

    await handler!({ actionId: 'open', sessionId: 's1' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(openChat).toHaveBeenCalled();
  });
});
