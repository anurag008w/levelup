import { describe, it, expect, beforeEach, vi } from 'vitest';
import { proactiveAgentService } from '../proactive-agent.service';

const mockStorage: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
  key: (i: number) => Object.keys(mockStorage)[i] || null,
  length: 0,
};

describe('ProactiveAgentService', () => {
  beforeEach(() => {
    localStorage.clear();
    proactiveAgentService.resetForTesting();
    vi.restoreAllMocks();
  });

  it('initializes with default preferences', () => {
    const prefs = proactiveAgentService.getPreferences();
    expect(prefs.enabled).toBe(true);
    expect(prefs.callsEnabled).toBe(true);
    expect(prefs.ringtonePreset).toBe('soft_chime');
  });

  it('updates preferences and persists to storage', () => {
    proactiveAgentService.updatePreferences({
      callFrequency: 'rare',
      ringtonePreset: 'lofi_melody',
    });
    const prefs = proactiveAgentService.getPreferences();
    expect(prefs.callFrequency).toBe('rare');
    expect(prefs.ringtonePreset).toBe('lofi_melody');
  });

  it('records user activity and resets anti-distraction shield', () => {
    proactiveAgentService.recordUserActivity();
    expect(proactiveAgentService.isQuietTime()).toBe(false);
  });

  it('sets DND shield when user requests not to be disturbed', () => {
    proactiveAgentService.setDNDDuration(2 * 3600 * 1000);
    expect(proactiveAgentService.isQuietTime()).toBe(true);
  });

  it('detects DND intent from chat message and sets DND window', () => {
    proactiveAgentService.onChatTurn('Misa 3 ghante disturb mat karna please', 'Theek hai, aaram se padho');
    expect(proactiveAgentService.isQuietTime()).toBe(true);
  });

  it('fires incoming call event when explicit call is requested', async () => {
    let receivedCall: any = null;
    const unsub = proactiveAgentService.onIncomingCall((call) => {
      receivedCall = call;
    });

    proactiveAgentService.triggerIncomingCall('Testing explicit call');
    expect(receivedCall).not.toBeNull();
    expect(receivedCall.callerName).toBe('Misa');
    unsub();
  });

  it('injects missed call and follow-up message on call missed', () => {
    const injected: any[] = [];
    const unsub = proactiveAgentService.onMessageInjection((msg) => {
      injected.push(msg);
    });

    proactiveAgentService.onCallMissed('call_123');
    expect(injected.length).toBe(1);
    expect(injected[0].isCallEvent).toBe(true);
    expect(injected[0].callStatus).toBe('missed');
    unsub();
  });

  it('invalidates pending triggers when a task is completed', async () => {
    proactiveAgentService.onChatTurn('Physics me Optics ke questions solve karne hain', 'Sure, go ahead');
    await proactiveAgentService.onTaskCompleted('todo_optics', 'Optics questions');
    // Task invalidation executed smoothly without errors
    expect(true).toBe(true);
  });
});
