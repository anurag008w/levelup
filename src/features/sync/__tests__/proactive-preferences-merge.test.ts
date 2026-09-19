import { describe, expect, it } from 'vitest';
import { mergeMisaData } from '../sync-merge';
import { DEFAULT_RELATIONSHIP_STATE } from '../../ai/relationship-state';
import type { MisaSyncPayload } from '../sync.service';
import type { ProactivePreferences } from '../../ai/proactive-agent.service';

const prefs = (overrides: Partial<ProactivePreferences> = {}): ProactivePreferences => ({
  enabled: true,
  callsEnabled: true,
  callFrequency: 'balanced',
  quietHoursStart: '01:00',
  quietHoursEnd: '07:00',
  ringtonePreset: 'soft_chime',
  activeGraceMinutes: 30,
  ...overrides,
});

const payload = (proactivePrefs: ProactivePreferences): MisaSyncPayload => ({
  version: 1,
  relationship: { ...DEFAULT_RELATIONSHIP_STATE },
  proactive: {
    prefs: proactivePrefs,
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

describe('mergeMisaData — proactive preference semantics', () => {
  it('preserves the larger active grace period regardless of device order', () => {
    const local = payload(prefs({ activeGraceMinutes: 10 }));
    const remote = payload(prefs({ activeGraceMinutes: 45 }));

    expect(mergeMisaData(local, remote)?.proactive.prefs.activeGraceMinutes).toBe(45);
    expect(mergeMisaData(remote, local)?.proactive.prefs.activeGraceMinutes).toBe(45);
  });

  it('does not let a blank local ringtone erase a nonblank remote ringtone', () => {
    const local = payload(prefs({ customRingtoneUrl: '   ' }));
    const remote = payload(prefs({ customRingtoneUrl: 'https://example.test/ringtone.mp3' }));

    expect(mergeMisaData(local, remote)?.proactive.prefs.customRingtoneUrl)
      .toBe('https://example.test/ringtone.mp3');
    expect(mergeMisaData(remote, local)?.proactive.prefs.customRingtoneUrl)
      .toBe('https://example.test/ringtone.mp3');
  });
});
