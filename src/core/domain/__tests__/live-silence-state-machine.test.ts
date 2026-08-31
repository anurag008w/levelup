import { describe, it, expect, beforeEach } from 'vitest';
import { LiveSilenceStateMachine } from '../live-silence-state-machine';

describe('LiveSilenceStateMachine', () => {
  let fsm: LiveSilenceStateMachine;

  beforeEach(() => {
    fsm = new LiveSilenceStateMachine();
  });

  it('starts in FOCUS state and remains mute for silence < 10s', () => {
    expect(fsm.getState()).toBe('FOCUS');
    const res = fsm.evaluate({ silenceDurationSec: 5, isCameraOrScreenActive: false });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('FOCUS');
  });

  it('transitions to OBSERVING when silence reaches 10s', () => {
    const res = fsm.evaluate({ silenceDurationSec: 12, isCameraOrScreenActive: true });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('OBSERVING');
  });

  it('enters DEEP_FOCUS when active pen/cursor motion is detected during silence', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 12,
      isCameraOrScreenActive: true,
      isPenOrCursorMoving: true,
    });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('DEEP_FOCUS');
  });

  it('transitions to CHECK_IN and returns verbal prompt after 15s silence', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 16,
      isCameraOrScreenActive: false,
      topicMemoryContext: 'Ray Optics',
    });
    expect(res).not.toBeNull();
    expect(res).toContain('SYSTEM EVENT');
    expect(res).toContain('Ray Optics');
    expect(fsm.getState()).toBe('CHECK_IN');
    expect(fsm.getStreakCount()).toBe(1);
  });

  it('progresses to stage 2 check-in when silence continues and resets on speech', () => {
    const now = Date.now();
    fsm.evaluate({ silenceDurationSec: 16, isCameraOrScreenActive: false }, now);
    expect(fsm.getStreakCount()).toBe(1);

    // After 18s cooldown, second silence check-in
    const res2 = fsm.evaluate({ silenceDurationSec: 20, isCameraOrScreenActive: false }, now + 18000);
    expect(res2).not.toBeNull();
    expect(fsm.getStreakCount()).toBe(2);

    // Speech resets streak
    fsm.onSpeechActivity();
    expect(fsm.getState()).toBe('FOCUS');
    expect(fsm.getStreakCount()).toBe(0);
  });
});
