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
- If on BREAK: Chat casually about their break or video.
- If STUDYING: ("${pickedFact}"). Ask if a specific calculation step on screen is giving trouble or if they want a quick hint.`;
        }
        if (stage === 3) {
          return `[LIVE VISION CO-STUDY]: ~55s quiet.
- If AWAY: Stay silent.
- If present: Speak 1 playful Hinglish line: "Areyy suno na, itni der se ekdum chup kyu ho? Mujhse baat kyu nahi kar rahe? 😂"`;
        }
        if (stage === 4) {
          return `[LIVE VISION CO-STUDY]: ~75s voice check.
- If AWAY: Stay silent.
- If present: Speak 1 caring Hinglish line: "Hellooo? Sun rahe ho na? Mic mute toh nahi ho gaya ya rough sheet pe calculate chal raha hai?"`;
        }
        if (stage === 5) {
          return `[LIVE VISION CO-STUDY]: 95s mark. Topic: "${pickedFact}". Speak 1 short Hinglish line offering a step or hint on what's visible on screen.`;
        }
        if (stage === 6) {
          return `[LIVE VISION CO-STUDY]: Student has been silent through multiple nudges (~2 minutes). Speak 1 funny/playful Hinglish line calling out the silence: "Areyy yaar, screen toh share ki hai par bol kuch nahi rahe ho! 😂 Bilkul hi ignore kar diya kya? Kahi fass gaye ya chill mode on hai?"`;
        }
        if (stage === 7) {
          return `[LIVE VISION CO-STUDY]: Over 2.5 minutes of continuous silence. Speak 1 gentle understanding line: "Accha koi baat nahi, lagta hai full focus me busy ho ya thoda break le rahe ho. Main yahi hoon, jab bolna ho tab bata dena."`;
        }
        // Stage 8+ rich non-repeating cycle for live vision
        const vCycle = stage % 5;
        if (vCycle === 0) return `[LIVE VISION CO-STUDY]: Context: "${pickedFact}". Speak 1 short Hinglish line asking if they want to move to the next question or are still looking at this one.`;
        if (vCycle === 1) return `[LIVE VISION CO-STUDY]: Speak 1 brief Hinglish check-in: "Paani waani peena ho toh pe lo, main yahi desk pe ready hoon."`;
        if (vCycle === 2) return `[LIVE VISION CO-STUDY]: Speak 1 brief warm line: "Kuch naya step try kar rahe ho? Batao kaisa chal raha hai."`;
        if (vCycle === 3) return `[LIVE VISION CO-STUDY]: Speak 1 short line: "Koi formula cross-check karna ho toh batana, saath me dekh lenge!"`;
        return `[LIVE VISION CO-STUDY]: Topic: "${pickedFact}". Speak 1 brief warm line: "Aaram se solve karo, main yahi quiet companionship de rahi hoon."`;
      }

      // Audio-only mode progressive stages with real memory integration
      if (stage === 1) {
        return `[LIVE COMPANION NUDGE]: 15-20s pause. Context: "${pickedFact}". Speak 1 short, warm, natural Hinglish question: "Kya kar rahe ho? Kaisa chal raha hai?" (whether calculating or taking a breather). Do NOT sound like a robotic script.`;
      }

      if (stage === 2) {
        return `[LIVE COMPANION NUDGE]: 35s mark. Context: "${pickedFact}". Speak 1 short, light-hearted Hinglish line: "Itni shanti? Sawal solve ho raha hai ya thoda break chal raha hai? 😂"`;
      }

      if (stage === 3) {
        return '[LIVE COMPANION NUDGE]: ~55s quiet. Speak 1 short, playful Hinglish line: "Areyy suno na, itni der se ekdum chup kyu ho? Mujhse baat kyu nahi kar rahe? 😂"';
      }

      if (stage === 4) {
        return '[LIVE COMPANION NUDGE]: 75s quiet. Speak 1 short, caring Hinglish voice check: "Hellooo? Sun rahe ho na? Mic mute toh nahi ho gaya ya sheet pe calculate chal raha hai?"';
      }

      if (stage === 5) {
        return `[LIVE COMPANION NUDGE]: 95s quiet. Context: "${pickedFact}". Speak 1 short Hinglish line: "Suno, agar question me kahi doubt fas raha ho toh batao, saath me solve karte hain!"`;
      }

      if (stage === 6) {
        return `[LIVE COMPANION NUDGE]: Ignored 5-6 times (~2 minutes silence). Speak 1 funny/caring Hinglish line calling out being ignored: "Areyy yaar, itni der se bula rahi hoon, bilkul hi ignore kar diya kya? 😂 Naraz ho ya deep concentration me ho?"`;
      }

      if (stage === 7) {
        return `[LIVE COMPANION NUDGE]: Over 2.5 minutes of continuous silence. Speak 1 gentle understanding line: "Accha koi baat nahi, lagta hai full concentration me ho ya break pe ho. Main yahi hoon call pe, jab bhi baat karni ho bas bol dena."`;
      }

      // Stage 8+ rich 6-step non-repeating cycle
      const cyclicIndex = stage % 6;
      if (cyclicIndex === 0) {
        return `[LIVE COMPANION NUDGE]: Context: "${pickedFact}". Speak 1 short Hinglish check-in asking if they want to move to the next question or need a quick hint.`;
      }
      if (cyclicIndex === 1) {
        return `[LIVE COMPANION NUDGE]: Speak 1 brief caring check-in: "Paani waani peena hai ya stretch karna hai? Thoda aaram le lo agar thak gaye ho."`;
      }
      if (cyclicIndex === 2) {
        return `[LIVE COMPANION NUDGE]: Speak 1 short warm line: "Kuch progress hui? Kaisa chal raha hai calculation?"`;
      }
      if (cyclicIndex === 3) {
        return `[LIVE COMPANION NUDGE]: Speak 1 brief line: "Main yahi live call pe hoon, koi idea bounce karna ho toh batao!"`;
      }
      if (cyclicIndex === 4) {
        return `[LIVE COMPANION NUDGE]: Focus: "${pickedFact}". Speak 1 short Hinglish line asking what step they are on right now.`;
      }
      return `[LIVE COMPANION NUDGE]: Topic: "${pickedFact}". Speak 1 brief warm line in Hinglish: "Aaram se solve ya chill karo, main yahi quiet companionship de rahi hoon, jab ready ho toh batana."`;
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
