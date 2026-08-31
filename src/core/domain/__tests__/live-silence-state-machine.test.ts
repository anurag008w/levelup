import { describe, it, expect, beforeEach } from 'vitest';
import { LiveSilenceStateMachine } from '../live-silence-state-machine';

describe('Canonical LiveSilenceStateMachine', () => {
  let fsm: LiveSilenceStateMachine;

  beforeEach(() => {
    fsm = new LiveSilenceStateMachine();
  });

  it('1. Remains in FOCUS and completely mute for silence < 20s', () => {
    expect(fsm.getState()).toBe('FOCUS');
    const res = fsm.evaluate({ silenceDurationSec: 10, isCameraOrScreenActive: false });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('FOCUS');
  });

  it('2. Transitions to OBSERVING between 20s and 60s without verbal interruption', () => {
    const res = fsm.evaluate({ silenceDurationSec: 35, isCameraOrScreenActive: true });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('OBSERVING');
  });

  it('3. Enters DEEP_FOCUS when user actively writes or calculates', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 45,
      isCameraOrScreenActive: true,
      visibleWriting: true,
      calculationProgress: true,
    });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('DEEP_FOCUS');
  });

  it('4. User verbal cue ("soch raha hu") triggers extended DEEP_FOCUS mode', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 40,
      isCameraOrScreenActive: true,
      userStatement: 'ek minute soch raha hu',
    });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('DEEP_FOCUS');
  });

  it('5. Transitions to POSSIBLE_STUCK and produces one check-in at 60s silence when not actively solving', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 65,
      isCameraOrScreenActive: false,
      topicMemoryContext: 'Ray Optics',
      hasErasuresOrStallSigns: true,
    });
    expect(res).not.toBeNull();
    expect(res).toContain('LIVE COMPANION NUDGE');
    expect(res).toContain('Ray Optics');
    expect(fsm.getState()).toBe('POSSIBLE_STUCK');
    expect(fsm.getStreakCount()).toBe(1);
  });

  it('6. Transitions to GENTLE_CHECK_IN at 120s mark and BACK_OFF after 180s', () => {
    const now = Date.now();
    // 60s check-in
    fsm.evaluate({ silenceDurationSec: 65, isCameraOrScreenActive: false }, now);
    expect(fsm.getStreakCount()).toBe(1);

    // 120s gentle check-in
    const res2 = fsm.evaluate({ silenceDurationSec: 130, isCameraOrScreenActive: false }, now + 25000);
    expect(res2).not.toBeNull();
    expect(fsm.getState()).toBe('GENTLE_CHECK_IN');
    expect(fsm.getStreakCount()).toBe(2);

    // 180s+ back off
    const res3 = fsm.evaluate({ silenceDurationSec: 190, isCameraOrScreenActive: false }, now + 50000);
    expect(res3).not.toBeNull();
    expect(res3).toContain('BACK-OFF');
    expect(fsm.getState()).toBe('BACK_OFF');
    expect(fsm.getStreakCount()).toBe(3);

    // Further silence beyond 180s remains quiet companion without repeating
    const res4 = fsm.evaluate({ silenceDurationSec: 220, isCameraOrScreenActive: false }, now + 75000);
    expect(res4).toBeNull();
  });

  it('7. Away state (empty chair) stays silent and avoids repeated callouts', () => {
    const res = fsm.evaluate({
      silenceDurationSec: 70,
      isCameraOrScreenActive: true,
      isEmptyRoomOrChair: true,
    });
    expect(res).toBeNull();
    expect(fsm.getState()).toBe('OBSERVING');
  });

  it('8. User speech activity resets state and silence streak count', () => {
    const now = Date.now();
    fsm.evaluate({ silenceDurationSec: 65, isCameraOrScreenActive: false }, now);
    expect(fsm.getStreakCount()).toBe(1);

    fsm.onSpeechActivity();
    expect(fsm.getState()).toBe('FOCUS');
    expect(fsm.getStreakCount()).toBe(0);
  });
});
