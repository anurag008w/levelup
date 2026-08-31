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
          return `[LIVE VISION CO-STUDY]: 15s pause. Look at the camera/screen feed right now:
- If AWAY / empty chair: Speak 1 brief warm line ("Lagta hai thodi der ke liye uth ke gaye ho... aao toh batana!").
- If on BREAK / videos / music / browsing: Speak 1 casual, chill Hinglish line about what is on screen ("Thoda break chal raha hai? Sahi hai!").
- If SOLVING / STUDYING: Look at the exact question/diagram/code on screen ("${pickedFact}"). Ask or comment directly on that specific question or step. Do NOT say 'main screen dekh rahi hu', speak directly about the screen content.`;
        }
        if (stage === 2) {
          return `[LIVE VISION CO-STUDY]: 35s mark. Look at screen/camera:
- If AWAY: Stay completely silent.
- If on BREAK: Chat casually about their break.
- If STUDYING: ("${pickedFact}"). Ask if a specific calculation step on screen is giving trouble or if they want a quick hint.`;
        }
        if (stage === 3) {
          return `[LIVE VISION CO-STUDY]: ~55s quiet.
- If AWAY: Stay silent.
- If present: Speak 1 playful Hinglish line: "Areyy itni shanti? Question me kahi calculation lambi chal rahi hai ya break chal raha hai? 😂"`;
        }
        if (stage === 4) {
          return `[LIVE VISION CO-STUDY]: ~75s voice check.
- If AWAY: Stay silent.
- If present: Speak 1 caring Hinglish line: "Hello? Sun rahe ho na? Mic mute toh nahi ho gaya ya rough sheet pe solve kar rahe ho?"`;
        }
        return `[LIVE VISION CO-STUDY]: Cyclic check. If solving ("${pickedFact}"), remind them you're right here whenever they want to bounce an idea. If relaxing, tell them to enjoy the break.`;
      }

      // Audio-only mode progressive stages with real memory integration
      if (stage === 1) {
        return `[LIVE COMPANION NUDGE]: 15-20s pause. Context: "${pickedFact}". Speak 1 short, warm, natural Hinglish question checking how it's going (whether calculating or taking a breather). Do NOT sound like a robotic script.`;
      }

      if (stage === 2) {
        return `[LIVE COMPANION NUDGE]: 35s mark. Context: "${pickedFact}". Speak 1 short, light-hearted Hinglish line: "Itni shanti? Sawal solve ho raha hai ya thoda break chal raha hai? 😂"`;
      }

      if (stage === 3) {
        return '[LIVE COMPANION NUDGE]: ~55s quiet. Speak 1 short, playful Hinglish line: "Areyy itni der se ekdum chup kyu ho? Kahi numerical me fass gaye ya chill kar rahe ho? 😂"';
      }

      if (stage === 4) {
        return '[LIVE COMPANION NUDGE]: 75s quiet. Speak 1 short, caring Hinglish voice check: "Hello? Sun rahe ho na? Mic mute toh nahi ho gaya ya sheet pe calculate chal raha hai?"';
      }

      if (stage === 5) {
        return `[LIVE COMPANION NUDGE]: 90s quiet. Context: "${pickedFact}". Speak 1 short Hinglish line: "Main yahi hoon call pe, agar koi doubt fas raha ho ya break ke baad solve karna ho toh batao, saath me karte hain!"`;
      }

      // Stage 6+ endless cyclic check-ins (never stops)
      const cyclicIndex = stage % 3;
      if (cyclicIndex === 0) {
        return `[LIVE COMPANION NUDGE]: Context: "${pickedFact}". Speak 1 short Hinglish check-in asking if they want to move to the next question or are still on break.`;
      }
      if (cyclicIndex === 1) {
        return `[LIVE COMPANION NUDGE]: Focus: "${pickedFact}". Speak 1 short Hinglish line asking what step or formula they are calculating right now.`;
      }
      return `[LIVE COMPANION NUDGE]: Topic: "${pickedFact}". Speak 1 brief warm line in Hinglish: "Pura time leke solve ya chill karo, main yahi hoon, jab ready ho toh batana."`;
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
