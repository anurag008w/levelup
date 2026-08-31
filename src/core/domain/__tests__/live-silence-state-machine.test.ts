import { describe, it, expect, beforeEach } from 'vitest';
import { LiveSilenceStateMachine } from '../live-silence-state-machine';

describe('LiveSilenceStateMachine', () => {
  let fsm: LiveSilenceStateMachine;

  beforeEach(() => {
    fsm = new LiveSilenceStateMachine();
  });

  it('starts in FOCUS state and remains mute for silence < 45s', () => {
    expect(fsm.getState()).toBe('FOCUS');
    const res = fsm.evaluate({ silenceDurationSec: 30, isCameraOrScreenActive: false });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('FOCUS');
  });

  it('transitions to OBSERVING when silence reaches 45s', () => {
    const res = fsm.evaluate({ silenceDurationSec: 50, isCameraOrScreenActive: true });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('OBSERVING');
  });

  it('enters DEEP_FOCUS when active pen/cursor motion is detected during silence', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 60,
      isCameraOrScreenActive: true,
      isPenOrCursorMoving: true,
    });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('DEEP_FOCUS');
  });

  it('transitions to CHECK_IN and returns verbal prompt after 90s of stall', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 95,
      isCameraOrScreenActive: true,
      isPenOrCursorMoving: false,
      hasErasuresOrStallSigns: true,
    });
    expect(res).not.toBeNull();
    expect(res).toContain('SYSTEM EVENT');
    expect(fsm.getState()).toBe('CHECK_IN');
  });

  it('resets to FOCUS when speech activity occurs', () => {
    fsm.evaluate({ silenceDurationSec: 50, isCameraOrScreenActive: false });
    expect(fsm.getState()).toBe('OBSERVING');

    fsm.onSpeechActivity();
    expect(fsm.getState()).toBe('FOCUS');
  });
});
