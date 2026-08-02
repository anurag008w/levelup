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
