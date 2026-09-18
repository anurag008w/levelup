import { describe, expect, it } from 'vitest';
import { DEFAULT_RELATIONSHIP_STATE } from '../../ai/relationship-state';
import type { ProactivePreferences } from '../../ai/proactive-agent.service';
import type { MisaSyncPayload } from '../sync.service';
import { mergeMisaData } from '../sync-merge';

const prefs = (over: Partial<ProactivePreferences> = {}): ProactivePreferences => ({
  enabled: true,
  callsEnabled: true,
  callFrequency: 'balanced',
  quietHoursStart: '01:00',
  quietHoursEnd: '07:00',
  ringtonePreset: 'soft_chime',
  activeGraceMinutes: 30,
  ...over,
});

const misa = (): MisaSyncPayload => ({
  version: 1,
  relationship: {
    ...DEFAULT_RELATIONSHIP_STATE,
    fatigue: { ...DEFAULT_RELATIONSHIP_STATE.fatigue, topicCooldowns: {} },
  },
  proactive: {
    prefs: prefs(),
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

describe('sync-merge — proactive cooldown integrity', () => {
  it('preserves the newer local cooldown when remote is stale', () => {
    const local = misa();
    local.relationship.fatigue.topicCooldowns = { optics: 5_000 };
    const remote = misa();
    remote.relationship.fatigue.topicCooldowns = { optics: 1_000 };

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.fatigue.topicCooldowns.optics).toBe(5_000);
  });

  it('preserves the newer remote cooldown when local is stale', () => {
    const local = misa();
    local.relationship.fatigue.topicCooldowns = { optics: 1_000 };
    const remote = misa();
    remote.relationship.fatigue.topicCooldowns = { optics: 5_000 };

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.fatigue.topicCooldowns.optics).toBe(5_000);
  });

  it('retains independent cooldown topics from both devices', () => {
    const local = misa();
    local.relationship.fatigue.topicCooldowns = { optics: 5_000, algebra: 2_000 };
    const remote = misa();
    remote.relationship.fatigue.topicCooldowns = { optics: 1_000, geometry: 3_000 };

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.fatigue.topicCooldowns).toEqual({ optics: 5_000, algebra: 2_000, geometry: 3_000 });
  });

  it('ignores invalid local cooldown values instead of poisoning remote state', () => {
    const local = misa();
    local.relationship.fatigue.topicCooldowns = { optics: Number.NaN, algebra: -1 };
    const remote = misa();
    remote.relationship.fatigue.topicCooldowns = { optics: 5_000, algebra: 2_000 };

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.fatigue.topicCooldowns).toEqual({ optics: 5_000, algebra: 2_000 });
  });

  it('rejects remote numeric strings instead of persisting them as cooldowns', () => {
    const local = misa();
    local.relationship.fatigue.topicCooldowns = { optics: 4_000 };
    const remote = misa();
    remote.relationship.fatigue.topicCooldowns = {
      optics: '9999999999999' as unknown as number,
      algebra: 'not-a-number' as unknown as number,
      geometry: 3_000,
    };

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.fatigue.topicCooldowns).toEqual({ optics: 4_000, geometry: 3_000 });
  });
});
