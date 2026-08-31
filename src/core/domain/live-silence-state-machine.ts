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
          return `[LIVE VISION CO-STUDY]: Student has been quiet for 15s. Look at what they are writing or what is visible on screen/notebook in the video feed right now. Topic/Memory note: "${pickedFact}". Proactively speak 1 short, helpful Hinglish observation or question about what you see.`;
        }
        if (stage === 2) {
          return `[LIVE VISION CO-STUDY]: Student is still quietly working on the problem in the camera/screen after 35s. Memory context: "${pickedFact}". Speak 1 short Hinglish hint or ask if a specific calculation step or formula is giving trouble.`;
        }
        if (stage === 3) {
          return '[LIVE VISION CO-STUDY]: Student has been quiet on video for almost 1 minute without talking. Speak 1 short, playful Hinglish question asking why they are so quiet: "Areyy itni der se ekdum chup kyu ho? Kahi sawal me fass gaye ya calculation bohut lambi chal rahi hai? 😂"';
        }
        if (stage === 4) {
          return '[LIVE VISION CO-STUDY]: Student is still silent after 75s. Speak 1 short caring Hinglish voice check: "Hello? Sun rahe ho na? Mic mute toh nahi ho gaya ya rough sheet pe solve kar rahe ho?"';
        }
        return `[LIVE VISION CO-STUDY]: Student is working quietly on camera. Active memory: "${pickedFact}". Speak 1 brief encouraging Hinglish sentence reminding them you are watching the screen/desk with them and ready whenever they need a hint.`;
      }

      // Audio-only mode progressive stages with real memory integration
      if (stage === 1) {
        return `[LIVE COMPANION NUDGE]: Student has been quiet for 15-20s. Student memory/topic: "${pickedFact}". Proactively speak 1 short, warm, completely fresh Hinglish question or prompt to check how this calculation/problem is progressing. Do NOT sound generic.`;
      }

      if (stage === 2) {
        return `[LIVE COMPANION NUDGE]: Student is still quiet after 35s. Context: "${pickedFact}". Speak 1 short, humorous Hinglish sentence asking: "Itni shanti? Sawal solve ho raha hai ya calculation me kahi step fasa hai? 😂"`;
      }

      if (stage === 3) {
        return '[LIVE COMPANION NUDGE]: Student has been completely quiet for almost 1 minute without saying anything. Speak 1 short, playful, human-like Hinglish question asking why they are so quiet: "Areyy itni der se ekdum chup kyu ho? Kahi kisi numerical me fass gaye ya distracted ho gaye? 😂"';
      }

      if (stage === 4) {
        return '[LIVE COMPANION NUDGE]: Student is still silent after 75s. Speak 1 short, caring Hinglish voice check: "Hello? Sun rahe ho na? Mic mute toh nahi ho gaya ya paper pe rough work chal raha hai?"';
      }

      if (stage === 5) {
        return `[LIVE COMPANION NUDGE]: Student has been quiet for over 90s. Relevant memory: "${pickedFact}". Speak 1 short Hinglish sentence offering a targeted hint on this topic: "Main yahi hoon call pe, agar is concept me koi doubt fas raha ho toh batao, saath me solve karte hain!"`;
      }

      // Stage 6+ endless cyclic check-ins (never stops)
      const cyclicIndex = stage % 3;
      if (cyclicIndex === 0) {
        return `[LIVE COMPANION NUDGE]: Student is still quiet. Relevant memory: "${pickedFact}". Speak 1 short Hinglish check-in asking if they want to move to the next question or need a quick formula hint.`;
      }
      if (cyclicIndex === 1) {
        return `[LIVE COMPANION NUDGE]: Student is still quiet. Focus: "${pickedFact}". Speak 1 short Hinglish check-in asking what formula or step they are calculating right now.`;
      }
      return `[LIVE COMPANION NUDGE]: Student is still quiet. Topic: "${pickedFact}". Speak 1 brief warm sentence in Hinglish: "Pura time leke solve karo, main yahi hoon, jab answer aaye toh batana." Then stay ready for next turn.`;
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
