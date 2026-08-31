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
  memoryFactList?: string[];
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
   * progressing through natural multi-stage conversational nudges enriched with real durable memories.
   */
  evaluate(signal: SilenceSignal, now: number = Date.now()): string | null {
    // If user is in confirmed DEEP_FOCUS, stay silent until cooldown expires
    if (now < this.deepFocusUntil) {
      this.currentState = 'DEEP_FOCUS';
      return null;
    }

    // Cooldown between spoken check-ins (15-20s between proactive nudges)
    if (now - this.lastCheckInAt < 15000) {
      return null;
    }

    const { silenceDurationSec, isCameraOrScreenActive, isPenOrCursorMoving, hasErasuresOrStallSigns, topicMemoryContext, memoryFactList = [] } = signal;

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

      // Pick a random memory fact if available
      const pickedFact = memoryFactList.length > 0
        ? memoryFactList[Math.floor(Math.random() * memoryFactList.length)]
        : topicMemoryContext || 'Current Problem';

      if (isCameraOrScreenActive) {
        if (stage === 1) {
          return `[LIVE VISION CO-STUDY OBSERVATION]: Student has been quiet for 15s. Look at the camera/screen feed right now:
- If student is AWAY / chair is empty: Speak 1 brief warm sentence ("Lagta hai thodi der ke liye uth ke gaye ho... jab aao toh batana!").
- If student is taking a BREAK / watching videos / listening to music / browsing: Speak 1 friendly, chill Hinglish sentence acknowledging their break ("Thoda break chal raha hai? Sahi hai, mind fresh kar lo!").
- If student is STUDYING / SOLVING: Look at what problem/diagram/code is visible. Topic: "${pickedFact}". Speak 1 short, intuitive Hinglish observation about what you see on screen/paper.`;
        }
        if (stage === 2) {
          return `[LIVE VISION CO-STUDY OBSERVATION]: 35s mark. Look at the video/screen:
- If student is AWAY: Stay completely silent.
- If taking a BREAK: Playfully chat or ask how the break is going.
- If STUDYING: Memory: "${pickedFact}". Ask if a specific calculation step or formula on screen is giving trouble or if they need a hint.`;
        }
        if (stage === 3) {
          return `[LIVE VISION CO-STUDY OBSERVATION]: ~55s quiet. Look at the camera/screen:
- If student is AWAY: Stay silent.
- If taking a BREAK: Say take your time, relax properly!
- If STUDYING: Speak 1 playful Hinglish sentence: "Areyy itni shanti? Sawal me kahi calculation lambi chal rahi hai ya step fasa hai? 😂"`;
        }
        if (stage === 4) {
          return `[LIVE VISION CO-STUDY OBSERVATION]: ~75s quiet. Voice check:
- If student is AWAY: Stay silent.
- If present: Speak 1 caring Hinglish voice check: "Hello? Sun rahe ho na? Mic mute toh nahi ho gaya ya sheet pe calculate kar rahe ho?"`;
        }
        return `[LIVE VISION CO-STUDY OBSERVATION]: Cyclic check. If student is studying with "${pickedFact}", remind them you are right here on screen whenever they want to bounce an idea or need a hint. If on break, encourage them to enjoy the break and tell you whenever ready to resume.`;
      }

      // Audio-only mode progressive stages with real memory integration
      if (stage === 1) {
        return `[LIVE COMPANION NUDGE]: Student has been quiet for 15-20s. Topic context: "${pickedFact}". Proactively speak 1 short, warm, natural Hinglish question checking how they are doing (whether solving or taking a breather). Keep it fresh and conversational.`;
      }

      if (stage === 2) {
        return `[LIVE COMPANION NUDGE]: Student is still quiet after 35s. Context: "${pickedFact}". Speak 1 short, light-hearted Hinglish sentence: "Itni shanti? Sawal solve ho raha hai ya thoda break chal raha hai? 😂"`;
      }

      if (stage === 3) {
        return '[LIVE COMPANION NUDGE]: Student has been completely quiet for almost 1 minute. Speak 1 short, playful, human-like Hinglish question asking why they are so quiet: "Areyy itni der se ekdum chup kyu ho? Kahi kisi numerical me fass gaye ya chill kar rahe ho? 😂"';
      }

      if (stage === 4) {
        return '[LIVE COMPANION NUDGE]: Student is still silent after 75s. Speak 1 short, caring Hinglish voice check: "Hello? Sun rahe ho na? Mic mute toh nahi ho gaya ya paper pe rough work chal raha hai?"';
      }

      if (stage === 5) {
        return `[LIVE COMPANION NUDGE]: Student has been quiet for over 90s. Relevant memory: "${pickedFact}". Speak 1 short Hinglish sentence offering a targeted hint on this topic: "Main yahi hoon call pe, agar is concept me koi doubt fas raha ho ya break ke baad restart karna ho toh batao, saath me solve karte hain!"`;
      }

      // Stage 6+ endless cyclic check-ins (never stops)
      const cyclicIndex = stage % 3;
      if (cyclicIndex === 0) {
        return `[LIVE COMPANION NUDGE]: Student is still quiet. Relevant memory: "${pickedFact}". Speak 1 short Hinglish check-in asking if they want to move to the next question or are still taking a short break.`;
      }
      if (cyclicIndex === 1) {
        return `[LIVE COMPANION NUDGE]: Student is still quiet. Focus: "${pickedFact}". Speak 1 short Hinglish check-in asking what formula or step they are calculating right now.`;
      }
      return `[LIVE COMPANION NUDGE]: Student is still quiet. Topic: "${pickedFact}". Speak 1 brief warm sentence in Hinglish: "Pura time leke solve ya relax karo, main yahi hoon, jab ready ho toh batana." Then stay ready for next turn.`;
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
