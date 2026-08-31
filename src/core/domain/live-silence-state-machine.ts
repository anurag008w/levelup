/**
 * Canonical Live Co-Study Silence State Machine (Silence ≠ Needing Help)
 *
 * Canonical Timeline:
 * - 0–20s:   FOCUS -> Completely mute.
 * - 20–60s:  OBSERVING -> Monitor voice/vision/activity. No interruption.
 * - 60–120s: POSSIBLE_STUCK -> Speak only if stuck confidence is high.
 * - 120–180s: GENTLE_CHECK_IN -> One brief relevant check-in if appropriate.
 * - 180s+:   BACK_OFF / QUIET_COMPANION -> Stop repeatedly interrupting.
 *
 * Adaptive Extensions:
 * - Active writing, scrolling, cursor motion, or calculations automatically extend quiet mode.
 * - User verbal cues ("solving hu", "wait", "soch raha hu") trigger immediate 120s DEEP_FOCUS.
 * - Away state (empty desk / chair) suppresses repeated callouts.
 * - Any user speech resets silence counters.
 */

import {
  evaluateActivitySignal,
  type RawActivityInputs,
  type EvaluatedActivitySignal,
} from './activity-signal';

export type SilenceState =
  | 'FOCUS'
  | 'OBSERVING'
  | 'DEEP_FOCUS'
  | 'POSSIBLE_STUCK'
  | 'GENTLE_CHECK_IN'
  | 'BACK_OFF';

export type SilenceSignal = RawActivityInputs;

export class LiveSilenceStateMachine {
  private currentState: SilenceState = 'FOCUS';
  private deepFocusUntil: number = 0;
  private lastCheckInAt: number = 0;
  private silenceStreakCount: number = 0;
  private lastEvaluatedSignal: EvaluatedActivitySignal | null = null;

  getState(): SilenceState {
    return this.currentState;
  }

  getStreakCount(): number {
    return this.silenceStreakCount;
  }

  getLastSignal(): EvaluatedActivitySignal | null {
    return this.lastEvaluatedSignal;
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
   * Returns a verbal prompt string ONLY when an adaptive threshold is crossed
   * and stuck-confidence warrants a gentle voice intervention.
   */
  evaluate(signal: SilenceSignal, now: number = Date.now()): string | null {
    const evaluated = evaluateActivitySignal(signal);
    this.lastEvaluatedSignal = evaluated;

    const {
      silenceDurationSec,
      isCameraOrScreenActive,
      topicMemoryContext,
      memoryFactList = [],
    } = signal;

    // 1. Explicit verbal quiet request ("solving hu", "wait", "soch raha hu")
    if (evaluated.isExtendedQuietRequested) {
      this.currentState = 'DEEP_FOCUS';
      this.deepFocusUntil = now + evaluated.quietExtensionDurationMs;
      return null;
    }

    // 2. If user is inside an active DEEP_FOCUS window, remain silent
    if (now < this.deepFocusUntil) {
      this.currentState = 'DEEP_FOCUS';
      return null;
    }

    // 3. User is actively solving/writing -> automatically extend quiet window by 45s
    if (evaluated.studyActivityScore >= 0.4 && !evaluated.stuckConfidence) {
      this.currentState = 'DEEP_FOCUS';
      this.deepFocusUntil = now + 45000;
      return null;
    }

    // 4. User is away -> stay silent, do not harass empty desk
    if (evaluated.awayConfidence >= 0.7) {
      this.currentState = 'OBSERVING';
      return null;
    }

    // 5. Cooldown between spoken check-ins (min 20s between interventions)
    if (now - this.lastCheckInAt < 20000) {
      return null;
    }

    // Pick a memory fact if available for context
    const pickedFact =
      memoryFactList.length > 0
        ? memoryFactList[Math.floor(Math.random() * memoryFactList.length)]
        : topicMemoryContext || 'Current Problem';

    // ── CANONICAL TIMELINE ───────────────────────────────────────────────────

    // 0–20s: FOCUS -> Strictly mute
    if (silenceDurationSec < 20) {
      this.currentState = 'FOCUS';
      return null;
    }

    // 20–60s: OBSERVING -> Monitor vision/voice signals without verbal interruption
    if (silenceDurationSec >= 20 && silenceDurationSec < 60) {
      this.currentState = 'OBSERVING';
      return null;
    }

    // 60–120s: POSSIBLE_STUCK -> Speak only if stuck confidence >= 0.4 or clear stall signs
    if (silenceDurationSec >= 60 && silenceDurationSec < 120) {
      this.currentState = 'POSSIBLE_STUCK';

      // If user is solving smoothly or reading, continue silence
      if (evaluated.studyActivityScore >= 0.35 && evaluated.stuckConfidence < 0.3) {
        return null;
      }

      // Check-in only if stuck confidence is present or first time reaching 60s
      if (this.silenceStreakCount === 0) {
        this.silenceStreakCount = 1;
        this.lastCheckInAt = now;

        if (isCameraOrScreenActive) {
          return `[LIVE VISION CO-STUDY]: Student paused at 60s mark. Context: "${pickedFact}". Look at what is on screen right now:
- If watching video / casual break: Speak 1 brief chill Hinglish line acknowledging the break.
- If solving: Ask 1 short, intuitive question about the specific step on screen (e.g. calculation or formula). Do NOT say generic helper phrases.`;
        }

        return `[LIVE COMPANION NUDGE]: Student has been thinking quietly for ~1 minute. Topic: "${pickedFact}". Speak 1 short, warm Hinglish question checking how the step is coming along: "Kya kar rahe ho? Kaisa chal raha hai calculation?"`;
      }
      return null;
    }

    // 120–180s: GENTLE_CHECK_IN -> One brief relevant check-in if appropriate
    if (silenceDurationSec >= 120 && silenceDurationSec < 180) {
      this.currentState = 'GENTLE_CHECK_IN';

      if (this.silenceStreakCount === 1) {
        this.silenceStreakCount = 2;
        this.lastCheckInAt = now;

        if (isCameraOrScreenActive) {
          return `[LIVE VISION CO-STUDY]: 2 minutes quiet. Look at the screen/desk:
- If studying ("${pickedFact}"): Ask if a specific calculation step is stuck or if they want a quick hint.
- If present but quiet: Speak 1 playful Hinglish line: "Areyy suno na, itni der se ekdum chup ho! Mujhse baat kyu nahi kar rahe? 😂"`;
        }

        return `[LIVE COMPANION NUDGE]: ~2 minutes silence. Context: "${pickedFact}". Speak 1 short, caring Hinglish line: "Suno, agar question me kahi calculation ya formula fasa ho toh batao, saath me dekhte hain!"`;
      }
      return null;
    }

    // 180s+: BACK_OFF / QUIET_COMPANION -> Stop repeatedly interrupting
    if (silenceDurationSec >= 180) {
      this.currentState = 'BACK_OFF';

      // Give 1 final respectful back-off line if reached stage 3, then stay quiet
      if (this.silenceStreakCount === 2) {
        this.silenceStreakCount = 3;
        this.lastCheckInAt = now;
        return `[LIVE COMPANION QUIET BACK-OFF]: Over 3 minutes quiet. Speak 1 gentle understanding line: "Accha koi baat nahi, lagta hai full focus me busy ho ya thoda break le rahe ho. Main yahi hoon, jab bhi baat karni ho bas bol dena." Then remain quiet companion.`;
      }

      // Beyond 3 check-ins: Stay quiet companion (do not spam)
      return null;
    }

    return null;
  }

  reset(): void {
    this.currentState = 'FOCUS';
    this.deepFocusUntil = 0;
    this.lastCheckInAt = 0;
    this.silenceStreakCount = 0;
    this.lastEvaluatedSignal = null;
  }
}
