import { describe, expect, it } from 'vitest';
import { mergeChatSessions, mergeMisaData } from '../sync-merge';
import { DEFAULT_RELATIONSHIP_STATE } from '../../ai/relationship-state';
import type { ChatSession } from '../../../core/domain/chat';
import type { MisaSyncPayload } from '../sync.service';

const session = (over: Partial<ChatSession>): ChatSession => ({
  id: 's1',
  title: 'New Chat',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  prefs: {} as never,
  messages: [],
  ...over,
});

const misa = (over: Partial<MisaSyncPayload['proactive']['prefs']> = {}): MisaSyncPayload => ({
  version: 1,
  relationship: { ...DEFAULT_RELATIONSHIP_STATE },
  proactive: {
    prefs: {
      enabled: true,
      callsEnabled: true,
      callFrequency: 'balanced',
      quietHoursStart: '01:00',
      quietHoursEnd: '07:00',
      ringtonePreset: 'soft_chime',
      activeGraceMinutes: 30,
      ...over,
    },
    lastActiveTimestamp: 0,
    lastUserChatTimestamp: 0,
    lastCallTimestamp: 0,
    lastCallDeclinedTimestamp: 0,
    consecutiveCallDeclines: 0,
    dndUntilTimestamp: 0,
    coldStartDone: false,
    pendingTriggers: [],
    scheduledMessages: [],
    missedInteractions: [],
  },
});

describe('sync merge conflict hardening', () => {
  it('resolves equal chat timestamps deterministically regardless of argument order', () => {
    const a = session({ title: 'Alpha', prefs: { providerId: 'a' } as never });
    const b = session({ title: 'Beta', prefs: { providerId: 'b' } as never });
    const ab = mergeChatSessions([a], [b])[0];
    const ba = mergeChatSessions([b], [a])[0];
    expect(ab.title).toBe(ba.title);
    expect(ab.prefs).toEqual(ba.prefs);
  });

  it('preserves the deterministic winner for equal timestamps and same-id message conflicts', () => {
    const a = session({ title: 'Alpha', messages: [{ id: 'm1', role: 'assistant', content: 'alpha', createdAt: '2026-01-01T10:00:00.000Z' }] });
    const b = session({ title: 'Beta', messages: [{ id: 'm1', role: 'assistant', content: 'beta', createdAt: '2026-01-01T10:00:00.000Z' }] });
    const ab = mergeChatSessions([a], [b])[0];
    const ba = mergeChatSessions([b], [a])[0];
    expect(ab.messages[0].content).toBe(ba.messages[0].content);
  });

  it('retains the stronger active grace period and nonblank custom ringtone during proactive sync', () => {
    const local = misa({ activeGraceMinutes: 10, customRingtoneUrl: '   ' });
    const remote = misa({ activeGraceMinutes: 45, customRingtoneUrl: 'https://example.com/ringtone.mp3' });
    const merged = mergeMisaData(local, remote)!;
    expect(merged.proactive.prefs.activeGraceMinutes).toBe(45);
    expect(merged.proactive.prefs.customRingtoneUrl).toBe('https://example.com/ringtone.mp3');
  });
});
