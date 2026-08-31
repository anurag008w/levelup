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
  topicMemoryContext?: string;
}

export class LiveSilenceStateMachine {
  private currentState: SilenceState = 'FOCUS';
  private deepFocusUntil: number = 0;
  private lastCheckInAt: number = 0;
  private silenceStreakCount: number = 0;

  getState(): SilenceState {
    return this.currentState;
  }

  getStreakCount(): number {
    return this.silenceStreakCount;
  }

  /**
   * Called on every audio/speech activity from user or assistant.
   */
  onSpeechActivity(): void {
    this.currentState = 'FOCUS';
    this.silenceStreakCount = 0;
  }

  /**
   * Evaluates the current silence signal and transitions the state machine.
   * Proactively triggers every 15-20s of quiet thinking during live co-study,
   * progressing through natural multi-stage conversational nudges.
   */
  evaluate(signal: SilenceSignal, now: number = Date.now()): string | null {
    // If user is in confirmed DEEP_FOCUS, stay silent until cooldown expires
    if (now < this.deepFocusUntil) {
      this.currentState = 'DEEP_FOCUS';
      return null;
    }

    // Cooldown between spoken check-ins (15-20s between proactive nudges)
    if (now - this.lastCheckInAt < 16000) {
      return null;
    }

    const { silenceDurationSec, isCameraOrScreenActive, isPenOrCursorMoving, hasErasuresOrStallSigns, topicMemoryContext } = signal;

    if (silenceDurationSec < 10) {
      this.currentState = 'FOCUS';
      return null;
    }

    if (silenceDurationSec >= 10 && silenceDurationSec < 15) {
      this.currentState = 'OBSERVING';

      if (isPenOrCursorMoving && !hasErasuresOrStallSigns) {
        // Confirmed active writing/typing -> enter DEEP_FOCUS for 60 seconds
        this.currentState = 'DEEP_FOCUS';
        this.deepFocusUntil = now + 60000;
        return null;
      }
      return null;
    }

    // Silence >= 15s (15-20s proactive cycle)
    if (silenceDurationSec >= 15) {
      this.currentState = 'CHECK_IN';
      this.lastCheckInAt = now;
      this.silenceStreakCount += 1;
      const stage = this.silenceStreakCount;

      if (isCameraOrScreenActive) {
        if (stage === 1) {
          return '[SYSTEM EVENT: Student has been quiet for 15-20s. Look at what they are writing or what is visible on screen/desk right now in the video feed, and speak 1 short, helpful Hinglish observation or question.]';
        }
        if (stage === 2) {
          return '[SYSTEM EVENT: Student is still quietly working on the problem in the camera/screen. Speak 1 short Hinglish hint or ask if a specific formula is giving trouble.]';
        }
        return '[SYSTEM EVENT: Student is deeply concentrating on the desk. Speak 1 brief encouraging sentence in Hinglish reminding them you are right here on call whenever they need a hint.]';
      }

      if (stage === 1) {
        if (topicMemoryContext) {
          return `[SYSTEM EVENT: Student has been quiet for 15-20s. Topic context: "${topicMemoryContext}". Proactively speak 1 short, warm Hinglish question or prompt to check how this calculation/problem is progressing.]`;
        }
        return '[SYSTEM EVENT: Student has been quiet for 15-20s. Proactively speak 1 short, friendly Hinglish sentence asking how the current step is going.]';
      }

      if (stage === 2) {
        if (topicMemoryContext) {
          return `[SYSTEM EVENT: Student is still quiet after 35s. Topic: "${topicMemoryContext}". Speak 1 short, light-hearted Hinglish sentence asking if they got stuck on a concept or want to do the next step together.]`;
        }
        return '[SYSTEM EVENT: Student is still quiet after 35s. Speak 1 short, humorous Hinglish sentence asking if calculation got intense or if they need a hint.]';
      }

      return '[SYSTEM EVENT: Student is quietly focusing. Speak 1 brief warm sentence in Hinglish saying "Pura time leke solve karo, main yahi hoon, jab answer aaye toh batana." Then stay quietly observant.]';
    }

    return null;
  }

  reset(): void {
    this.currentState = 'FOCUS';
    this.deepFocusUntil = 0;
    this.lastCheckInAt = 0;
    this.silenceStreakCount = 0;
  }
}
