import { describe, it, expect } from 'vitest';
import {
  CHAT_TRANSCRIPT_VERSION,
  SESSION_TAG_PREFIX,
  sessionMemoryTag,
  buildChatTranscript,
  parseChatTranscript,
  extractBlockTitle,
  stripBlockTitle,
} from '../chat-transcript';
import type { ChatSession, ChatPreferences } from '../chat';

const PREFS: ChatPreferences = {
  providerId: null,
  model: null,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  userPersona: '',
  includeContext: true,
};

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's1',
    title: 'Hello chat',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:05:00.000Z',
    prefs: PREFS,
    messages: [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T10:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'hello!', createdAt: '2026-01-01T10:01:00.000Z', model: 'gemini' },
    ],
    ...overrides,
  };
}

describe('chat-transcript encoding', () => {
  it('sessionMemoryTag prefixes the session id', () => {
    expect(sessionMemoryTag('abc')).toBe(`${SESSION_TAG_PREFIX}abc`);
  });

  it('buildChatTranscript round-trips through parseChatTranscript', () => {
    const session = makeSession();
    const json = buildChatTranscript(session);
    const parsed = parseChatTranscript(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.sessionId).toBe('s1');
    expect(parsed!.title).toBe('Hello chat');
    expect(parsed!.version).toBe(CHAT_TRANSCRIPT_VERSION);
    expect(parsed!.messages).toHaveLength(2);
    expect(parsed!.messages[1].model).toBe('gemini');
  });

  it('buildChatTranscript archives attachments, reasoning, tool and stopped state', () => {
    const session = makeSession({
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Solve this',
          createdAt: '2026-01-01T10:00:00.000Z',
          attachments: [
            { id: 'a1', name: 'photo.png', kind: 'image', previewUrl: 'blob:volatile', content: 'diagram text' },
            { id: 'a2', name: 'notes.txt', kind: 'file', content: 'raw notes' },
          ],
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Here you go',
          createdAt: '2026-01-01T10:01:00.000Z',
          reasoning: 'thinking…',
          tool: 'getPlan',
          stopped: true,
          model: 'gemini',
        },
      ],
    });

    const parsed = parseChatTranscript(buildChatTranscript(session))!;
    expect(parsed.messages[0].attachments).toHaveLength(2);
    expect(parsed.messages[0].attachments![0]).toEqual({ id: 'a1', name: 'photo.png', kind: 'image', content: 'diagram text' });
    // Volatile blob URLs must never be archived.
    expect(parsed.messages[0].attachments![0].previewUrl).toBeUndefined();
    expect(parsed.messages[1].reasoning).toBe('thinking…');
    expect(parsed.messages[1].tool).toBe('getPlan');
    expect(parsed.messages[1].stopped).toBe(true);
  });

  it('parseChatTranscript restores attachments defensively and skips invalid ones', () => {
    const parsed = parseChatTranscript(
      JSON.stringify({
        version: CHAT_TRANSCRIPT_VERSION,
        sessionId: 's1',
        title: 'T',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        messages: [
          {
            role: 'user',
            content: 'ok',
            attachments: [
              { id: 'a1', name: 'good.pdf', kind: 'binary', content: 'bytes' },
              { id: '', name: '', kind: 'text' }, // invalid id/name → skipped
              { name: 'missing-id', kind: 'file' }, // missing id → skipped
              'garbage',
              { id: 'a2', name: 'weird', kind: 'video', content: 'x' }, // unknown kind → 'file'
            ],
          },
        ],
      }),
    );
    expect(parsed!.messages[0].attachments).toHaveLength(2);
    expect(parsed!.messages[0].attachments![0]).toEqual({ id: 'a1', name: 'good.pdf', kind: 'binary', content: 'bytes' });
    expect(parsed!.messages[0].attachments![1]).toEqual({ id: 'a2', name: 'weird', kind: 'file', content: 'x' });
  });

  it('parseChatTranscript returns null for malformed input', () => {
    expect(parseChatTranscript('')).toBeNull();
    expect(parseChatTranscript('   ')).toBeNull();
    expect(parseChatTranscript('not json')).toBeNull();
    expect(parseChatTranscript('123')).toBeNull();
    expect(parseChatTranscript('null')).toBeNull();
    expect(parseChatTranscript('[]')).toBeNull();
    expect(parseChatTranscript(JSON.stringify({ version: 999, sessionId: 'x', messages: [] }))).toBeNull();
    expect(parseChatTranscript(JSON.stringify({ version: CHAT_TRANSCRIPT_VERSION, sessionId: 42, messages: [] }))).toBeNull();
  });

  it('parseChatTranscript skips corrupt messages and fills missing fields', () => {
    const parsed = parseChatTranscript(
      JSON.stringify({
        version: CHAT_TRANSCRIPT_VERSION,
        sessionId: 's1',
        title: 'T',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        messages: [
          { role: 'user', content: 'ok' },
          { role: 'system', content: 'drop me' }, // invalid role → skipped
          'garbage',
          { role: 'assistant', content: 5 }, // invalid content → skipped
        ],
      }),
    );
    expect(parsed!.messages).toHaveLength(1);
    expect(parsed!.messages[0].id).toBe('archived-0');
    expect(parsed!.messages[0].createdAt).toBe(new Date(0).toISOString());
  });

  it('extractBlockTitle reads a [Title] header line', () => {
    expect(extractBlockTitle('[Aim]\nTarget IIT Delhi')).toBe('Aim');
    expect(extractBlockTitle('Plain line\nno header')).toBeNull();
    expect(extractBlockTitle('')).toBeNull();
  });

  it('stripBlockTitle removes only a leading header line', () => {
    expect(stripBlockTitle('[Aim]\nTarget IIT Delhi')).toBe('Target IIT Delhi');
    expect(stripBlockTitle('No header here')).toBe('No header here');
    expect(stripBlockTitle('')).toBe('');
  });
});
