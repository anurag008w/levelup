/**
 * Live Co-Study Silence State Machine (Silence ≠ Needing Help)
 *
 * Prevents Misa from annoying or interrupting the student during deep focus.
 * Integrates silence duration, camera/screen observation, and activity hints.
 */

export type SilenceState =
  | 'FOCUS'          // 0s - 45s: Student is in normal focus flow. Mute.
  | 'OBSERVING'      // 45s - 75s: Inspecting vision frame without voice.
  | 'DEEP_FOCUS'     // Active writing / solving confirmed. Extended mute (180s).
  | 'POSSIBLE_STUCK' // Stalled for >75s, blank work or erasures.
  | 'CHECK_IN'       // Ready to offer 1 concise hint.
  | 'USER_CONTINUES';// Resumed solving.

export interface SilenceSignal {
  silenceDurationSec: number;
  isCameraOrScreenActive: boolean;
  isPenOrCursorMoving?: boolean;
  hasErasuresOrStallSigns?: boolean;
}

export class LiveSilenceStateMachine {
  private currentState: SilenceState = 'FOCUS';
  private deepFocusUntil: number = 0;
  private lastCheckInAt: number = 0;

  getState(): SilenceState {
    return this.currentState;
  }

  /**
   * Called on every audio/speech activity from user or assistant.
   */
  onSpeechActivity(): void {
    this.currentState = 'FOCUS';
  }

  /**
   * Evaluates the current silence signal and transitions the state machine.
   * Returns a verbal check-in prompt string IF AND ONLY IF state transitions to CHECK_IN.
   */
  evaluate(signal: SilenceSignal, now: number = Date.now()): string | null {
    // If user is in confirmed DEEP_FOCUS, stay silent until cooldown expires
    if (now < this.deepFocusUntil) {
      this.currentState = 'DEEP_FOCUS';
      return null;
    }

    // Cooldown between check-ins (min 120s between spoken check-ins)
    if (now - this.lastCheckInAt < 120000) {
      return null;
    }

    const { silenceDurationSec, isCameraOrScreenActive, isPenOrCursorMoving, hasErasuresOrStallSigns } = signal;

    if (silenceDurationSec < 45) {
      this.currentState = 'FOCUS';
      return null;
    }

    if (silenceDurationSec >= 45 && silenceDurationSec < 75) {
      this.currentState = 'OBSERVING';

      if (isPenOrCursorMoving) {
        // Confirmed active writing/typing -> enter DEEP_FOCUS for 3 minutes
        this.currentState = 'DEEP_FOCUS';
        this.deepFocusUntil = now + 180000;
        return null;
      }
      return null;
    }

    // Silence > 75s
    if (silenceDurationSec >= 75) {
      if (isPenOrCursorMoving && !hasErasuresOrStallSigns) {
        this.currentState = 'DEEP_FOCUS';
        this.deepFocusUntil = now + 180000;
        return null;
      }

      this.currentState = 'POSSIBLE_STUCK';

      // Silence > 90s with stall signs -> CHECK_IN
      if (silenceDurationSec >= 90 || hasErasuresOrStallSigns) {
        this.currentState = 'CHECK_IN';
        this.lastCheckInAt = now;

        if (isCameraOrScreenActive) {
          return '[SYSTEM EVENT: User has been quietly studying for 90s. Look at their textbook or notebook in the video frame, and speak 1 short supportive hint or observation in Hinglish.]';
        }
        return '[SYSTEM EVENT: User has been quietly thinking for 90s. Speak 1 short friendly sentence in Hinglish to casually ask if they need a hint with this step.]';
      }
    }

    return null;
  }

  reset(): void {
    this.currentState = 'FOCUS';
    this.deepFocusUntil = 0;
    this.lastCheckInAt = 0;
  }
}
