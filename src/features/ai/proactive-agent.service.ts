/**
 * Misa Autonomous Proactive Agent Service (Hardened Production Model)
 *
 * Canonical Rules:
 * 1. 4-Second Debounce (sealSessionTrigger): Only seals conversation intent, commitments,
 *    and schedules future background alarms. Never injects an instant user-facing message.
 * 2. 5-Minute In-Session Idle (evaluateSessionFollowUp): Evaluates active doubt follow-up
 *    strictly inside the active chat session without creating background notifications.
 * 3. 30-Minute Grace Period: Blocks all background notifications if user was active recently.
 * 4. Conservative Spontaneous Calls: Checks relationship confidence, fatigue, activity state,
 *    and decline history. Suppresses calls during DEEP_STUDY / SOLVING.
 * 5. Distinct Call States: ACCEPTED, DECLINED, MISSED, OFFLINE_CALL_ATTEMPT, TIMEOUT.
 * 6. Behavior Validation Layer (validateProactiveDelivery): Final check before any message delivery.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { ringtonePlayer, type RingtonePresetId } from '../../lib/ringtone-player';
import { relationshipManager, type SubjectArea } from './relationship-state';
import { socialDecisionEngine, type ProactiveCandidate } from './social-decision-engine';
import { validateProactiveDelivery } from './behavior-validator';
import type { UserActivityState } from '../../core/domain/activity-signal';

export interface ProactivePreferences {
  enabled: boolean;
  callsEnabled: boolean;
  callFrequency: 'rare' | 'balanced' | 'request_only'; // rare = 1 call/4d, balanced = 1 call/2d, request_only = only when user asks
  quietHoursStart: string; // e.g. "01:00"
  quietHoursEnd: string;   // e.g. "07:00"
  ringtonePreset: RingtonePresetId;
  customRingtoneUrl?: string;
  activeGraceMinutes: number; // default: 30 minutes
}

export const DEFAULT_PROACTIVE_PREFS: ProactivePreferences = {
  enabled: true,
  callsEnabled: true,
  callFrequency: 'balanced',
  quietHoursStart: '01:00',
  quietHoursEnd: '07:00',
  ringtonePreset: 'soft_chime',
  activeGraceMinutes: 30,
};

export type CallStatusType =
  | 'accepted'
  | 'declined'
  | 'missed'
  | 'offline_attempt'
  | 'timeout';

export interface ProactiveTrigger {
  id: number;
  idempotencyKey?: string;
  type: 'chat_nudge' | 'incoming_call' | 'inactivity' | 'cold_start' | 'session_followup';
  scheduledTime: number; // epoch ms
  topic?: string;
  intent?: 'reminder' | 'doubt_followup' | 'urgent_check' | 'recap' | 'general';
  relatedTaskId?: string;
  offlineMessage: string;
  callReason?: string;
  requiresOnline?: boolean;
}

export interface IncomingCallEvent {
  callId: string;
  reason: string;
  callerName: string;
  avatarUrl?: string;
}

export type IncomingCallListener = (event: IncomingCallEvent) => void;
export type MessageInjectionListener = (message: {
  role: 'assistant';
  text: string;
  isProactive?: boolean;
  isCallEvent?: boolean;
  callStatus?: CallStatusType;
}) => void;

const DYNAMIC_TEMPLATES: Record<string, string[]> = {
  inactivity_daytime: [
    "2-3 ghante se shanti hai! Numerical solve ho rahe hain ya koi step fasa hua hai? Batana saath me crack karte hain! 💪",
    "Suno, break se wapas aaye? Ek 30-minute ka focus sprint shuru karein? 🎯",
    "Hey! Next study session ka kya plan hai? Ek target decide kar lo, momentum turant banega!",
    "Padhai me flow bana ya distraction ho raha hai? Thoda pani piyo aur 1 topic uthate hain! 🥤",
    "Ek quick check-in — aaj ka subject kaisa progress kar raha hai? Revision smooth chal raha hai na?",
  ],
  optics: [
    'Optics ke ray diagrams solve hue kya? Sign convention me focal length dhyan se lena!',
    'Hey! Optics me Snell’s law ya lens formula ke pyqs attempt kiye kya? Batana agar koi case fasa ho.',
    'Optics ka target kaisa ja raha hai? Total internal reflection ke questions ek baar nazar mar lena!',
    'Ray optics me mirror formula calculate ho gaya? Coordinate axes properly draw karke sign lagana!',
  ],
  rotation: [
    'Rotational motion me moment of inertia ke formulas recall hue? Ek simple trick batau?',
    'Hey! Torque aur angular momentum conservation ke numericals try kiye? Concept clear chal raha hai na?',
    'Rotation me rolling without slipping wala part finish hua? Acceleration formula revise kar lena!',
    'Center of mass and rotational dynamics ke pyqs smooth hue ya koi numerical dubara dekhna hai?',
  ],
  organic: [
    'Organic chemistry ke mechanisms note kiye? Reaction chart ek baar revise kar lo!',
    'Hey! Nucleophilic substitution aur elimination reactions ke intermediate check kiye na?',
    'Named reactions yaad aa rahe hain? GOC ke stability orders ek baar jaldi se dekh lena!',
    'Organic reagents ke conversion pathways solve ho rahe hain? Reagent chart saath rakh ke solve karna!',
  ],
  thermodynamics: [
    'Thermodynamics me cyclic process ka work done calculate ho gaya na?',
    'Hey! First law aur adiabatic process ke formulas recall kar lo — sign convention check kiye?',
    'Entropy aur Carnot engine ke efficiency problems ban rahe hain? Koi specific step me doubt?',
    'PV diagrams ke graph interpretation clear ho gaye na? Ek light formula recap karein?',
  ],
  calculus: [
    'Calculus ke definite integration ke standard properties yaad hain na? Ek question try karein?',
    'Hey! Limits & Continuity ya differentiation ke questions smooth solve ho rahe hain?',
    'Integration by parts me ILATE rule dhyan me hai na? Standard substitution trick yaad rakhna!',
    'Differential equations ke variable separable aur linear form check kiye? Ekbaar nazar mar lo!',
  ],
  morning_plan: [
    'Good morning! Aaj ka study plan execute karna start kiya? Chhota task pehle uthao!',
    'Subah ki shuruaat! Pehla focus session 45 minute ka plan karein? Momentum turant banega!',
    'Uth gaye na? Aaj ke 3 main targets decide kiye? Ready ho to shuru karein!',
    'Good morning! Aaj sabse pehle hardest topic ka 1 section complete kar lo, poora din easy lagega!',
  ],
  rest_burnout: [
    'Thoda break liya? Ab mind fresh feel ho raha hai to ek 20m ka light revision karein?',
    'Suno, padhai important hai par 10m ki fresh air bhi! Thoda rest karke wapas start karte hain.',
    'Exhaustion feel ho raha tha to pani piyo aur 15m relax karo. Focus wapas aa jayega!',
    'Consistency marathon hai, sprint nahi. Break leke 1 question se wapas restart karein?',
  ],
  late_night_pattern: [
    'Notice kiya 2-3 din se continuous late night study ho rahi hai. Memory consolidate karne ke liye 6-7 hr sleep zaruri hai!',
    'Consistent late night stretch chal raha hai. Aaj thoda pehle wrap karke subah fresh mind se solve karein?',
  ],
  inactivity_24h: [
    'Aaj padhai kaisi chal rahi hai 🙂',
    'Hey! Aaj ka session start kiya? Chhota task pehle utha lo!',
    'Suno, break se wapas aaye? Ek quick 25-min sprint karein?',
  ],
  inactivity_48h: [
    'Kal se kaafi quiet ho... sab theek hai na? 🙂',
    'Hey! Thoda break theek hai, par aaj 1 topic review karke momentum wapas le aayein?',
    'Suno, agar koi concept fasa hai to text karo, saath me solve karte hain!',
  ],
  inactivity_96h: [
    'Koi baat nahi, reset karte hain — aaj ek chhota sa 15m win le lete hain!',
    'Fresh start! Past days ko chhod ke aaj ka Day 1 banate hain! Ready ho?',
    'No guilt, bas 1 formula sheet revise karke wapas flow me aa jao!',
  ],
  companion_humor: [
    'Aaj HC Verma ko dekh ke bhaag toh nahi gaye na 😂',
    'Physics ke sawal tumhe solve kar rahe hain ya tum unhe? 😂 Batana agar help chahiye!',
    'Areyy itni shanti? Lagta hai integration ne behosh kar diya 😂',
  ],
  celebration: [
    'Areyy ye wala target toh ho gaya 😭🔥',
    'Superb! Ek aur concept solid lock ho gaya! 🚀',
    'Shabaash! Consistency aisi hi banaye rakhna! 👏',
  ],
  jee_prep: [
    'Suno, question solving chal rahi hai na? Koi calculation me doubt ho to batana!',
    'Hey! Aaj ka revision target kaisa progress kar raha hai? Batana agar koi problem fasa ho.',
    'Study session kaisa chal raha hai? Ek quick doubt solve karna ho to batana!',
    'Focus ban gaya na? Ek numerical target complete karke batana kaisa raha!',
  ],
};

function pickVariedTemplate(topic: string, recentSent: string[] = []): string {
  const pool = DYNAMIC_TEMPLATES[topic] || DYNAMIC_TEMPLATES.jee_prep;
  const filtered = pool.filter((t) => !recentSent.includes(t));
  const available = filtered.length > 0 ? filtered : pool;
  return available[Math.floor(Math.random() * available.length)];
}

function pickContextualMessage(topic: string, relState?: any): string {
  const recentSent = relState?.recentSentMessages || [];

  // Check if user has an active planned commitment
  const commitment = relState?.commitments?.find((c: any) => c.state === "PLANNED");
  if (commitment && Math.random() < 0.45) {
    const commMsgs = [
      `Suno! Aaj ${commitment.topic} ka session plan tha na? Shuru kiya ya koi numerical fasa hai? 💪`,
      `Hey! ${commitment.topic} ke pyqs solve karne the na aaj? Kaisa chal raha hai progress? 🎯`,
      `${commitment.topic} wala target start hua? Batana agar koi concept dubara recall karna ho! 😊`,
    ];
    const availableComm = commMsgs.filter((m) => !recentSent.includes(m));
    if (availableComm.length > 0) {
      return availableComm[Math.floor(Math.random() * availableComm.length)];
    }
  }

  // Check if user had a recent struggle area
  if (relState?.currentProblemArea && Math.random() < 0.35) {
    const struggleMsgs = [
      `Woh ${relState.currentProblemArea} wala doubt clear ho gaya tha ya abhi bhi tricky lag raha hai? 💡`,
      `Suno, ${relState.currentProblemArea} me koi specific formula ya step dubara dekhna ho toh batana, saath me kar lenge! 🤝`,
    ];
    const availableStruggle = struggleMsgs.filter((m) => !recentSent.includes(m));
    if (availableStruggle.length > 0) {
      return availableStruggle[Math.floor(Math.random() * availableStruggle.length)];
    }
  }

  // Check if user had a pending promise
  const promise = relState?.pendingPromises?.find((p: any) => !p.isResumed);
  if (promise && Math.random() < 0.4) {
    return `Hey! Bol rahe the na baad me bataoge — ab batao kaisa raha target? 😏`;
  }

  return pickVariedTemplate(topic, recentSent);
}

const STORAGE_KEY = 'misa_proactive_agent_prefs_v2';

class ProactiveAgentService {
  private prefs: ProactivePreferences = { ...DEFAULT_PROACTIVE_PREFS };
  private lastActiveTimestamp = Date.now();
  private lastUserChatTimestamp = 0;
  private lastCallTimestamp = 0;
  private lastCallDeclinedTimestamp = 0;
  private consecutiveCallDeclines = 0;
  private dndUntilTimestamp = 0;
  private pendingTriggers: ProactiveTrigger[] = [];
  private debounceTimer: any = null;
  private sessionIdleTimer: any = null;
  private lastSessionTopic: string | null = null;
  private isUserCurrentlyInChat = false;
  private currentActivityState: UserActivityState = 'IDLE';

  private incomingCallListeners: Set<IncomingCallListener> = new Set();
  private messageInjectionListeners: Set<MessageInjectionListener> = new Set();

  constructor() {
    this.loadState();
    this.initPlatformNotifications();
  }

  private loadState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.prefs = { ...DEFAULT_PROACTIVE_PREFS, ...(parsed.prefs || {}) };
        this.lastActiveTimestamp = parsed.lastActiveTimestamp || Date.now();
        this.lastUserChatTimestamp = parsed.lastUserChatTimestamp || 0;
        this.lastCallTimestamp = parsed.lastCallTimestamp || 0;
        this.lastCallDeclinedTimestamp = parsed.lastCallDeclinedTimestamp || 0;
        this.consecutiveCallDeclines = parsed.consecutiveCallDeclines || 0;
        this.dndUntilTimestamp = parsed.dndUntilTimestamp || 0;
        this.pendingTriggers = parsed.pendingTriggers || [];
      }
    } catch (e) {
      console.warn('[ProactiveAgent] Failed to load preferences:', e);
    }
  }

  private saveState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          prefs: this.prefs,
          lastActiveTimestamp: this.lastActiveTimestamp,
          lastUserChatTimestamp: this.lastUserChatTimestamp,
          lastCallTimestamp: this.lastCallTimestamp,
          lastCallDeclinedTimestamp: this.lastCallDeclinedTimestamp,
          consecutiveCallDeclines: this.consecutiveCallDeclines,
          dndUntilTimestamp: this.dndUntilTimestamp,
          pendingTriggers: this.pendingTriggers,
        })
      );
    } catch (e) {
      console.warn('[ProactiveAgent] Failed to save state:', e);
    }
  }

  getPreferences(): ProactivePreferences {
    return { ...this.prefs };
  }

  updatePreferences(patch: Partial<ProactivePreferences>): void {
    this.prefs = { ...this.prefs, ...patch };
    if (patch.enabled === false) {
      void this.cancelAllPendingTriggers();
      ringtonePlayer.stop();
      this.pendingTriggers = [];
    }
    if (patch.callsEnabled === false) {
      this.pendingTriggers = this.pendingTriggers.filter((t) => t.type !== 'incoming_call');
      ringtonePlayer.stop();
    }
    if (patch.quietHoursStart || patch.quietHoursEnd || patch.activeGraceMinutes) {
      relationshipManager.update((s) => {
        if (patch.quietHoursStart) s.boundaries.quietHoursStart = patch.quietHoursStart;
        if (patch.quietHoursEnd) s.boundaries.quietHoursEnd = patch.quietHoursEnd;
        if (patch.activeGraceMinutes !== undefined) s.boundaries.activeGraceMinutes = patch.activeGraceMinutes;
      });
    }
    this.saveState();
  }

  setUserActivityState(state: UserActivityState): void {
    this.currentActivityState = state;
  }

  setInChatSession(inChat: boolean): void {
    this.isUserCurrentlyInChat = inChat;
    if (inChat) {
      this.recordUserActivity();
    }
  }

  async init(): Promise<void> {
    await this.initPlatformNotifications();
  }

  private async initPlatformNotifications(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.createChannel({
          id: 'misa_proactive_channel',
          name: 'Misa JEE Study Partner',
          description: 'Spontaneous check-ins, study nudges, and calls from Misa',
          importance: 5,
          visibility: 1,
          vibration: true,
          sound: 'res_custom_notification',
        });

        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }

        LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
          const extra = action.notification.extra;
          if (extra?.offlineMessage) {
            this.injectMessageIntoChat(extra.offlineMessage);
          }
        });
      } catch (err) {
        console.warn('[ProactiveAgent] LocalNotifications setup failed:', err);
      }
    }

    this.checkColdStartOnboarding();

    // Check & dispatch due scheduled triggers every 20 seconds
    setInterval(() => {
      this.checkAndDispatchDueTriggers();
    }, 20000);

    setInterval(() => {
      this.checkInactivityAndFire();
    }, 2 * 60 * 1000);

    setTimeout(() => {
      this.checkAndDispatchDueTriggers();
      this.checkInactivityAndFire();
    }, 5000);
  }

  private checkAndDispatchDueTriggers(): void {
    if (!this.prefs.enabled) return;
    if (this.isQuietTime()) return;

    const now = Date.now();
    const due = this.pendingTriggers.filter((t) => t.scheduledTime <= now);
    if (due.length === 0) return;

    this.pendingTriggers = this.pendingTriggers.filter((t) => t.scheduledTime > now);
    this.saveState();

    const relState = relationshipManager.getState();
    for (const trig of due) {
      if (trig.type === "incoming_call") {
        this.triggerIncomingCall(trig.callReason || "Scheduled study check-in");
        continue;
      }

      const validation = validateProactiveDelivery(
        {
          id: `trig_${trig.id}`,
          type: "commitment_followup",
          topic: trig.topic,
          urgency: 0.7,
          relevance: 0.85,
          confidence: 0.9,
          freshness: 0.9,
          offlineText: trig.offlineMessage,
          isInsideActiveSession: this.isUserCurrentlyInChat,
        },
        relState,
        {
          lastActiveTimestamp: this.lastActiveTimestamp,
          isInsideActiveSession: this.isUserCurrentlyInChat,
          recentSentMessages: relState.recentSentMessages,
          now,
        }
      );

      if (validation.valid) {
        const msg = validation.sanitizedText || trig.offlineMessage;
        this.injectMessageIntoChat(msg);
        relationshipManager.recordProactiveSent(trig.topic || "proactive_nudge", msg);
      }
    }
  }

  private checkInactivityAndFire(): void {
    if (!this.prefs.enabled) return;
    if (this.isQuietTime()) return;

    const now = Date.now();
    const inactiveSince = now - this.lastUserChatTimestamp;
    const activeSince = now - this.lastActiveTimestamp;

    // 30-min active grace period: user is using app actively, do not interrupt
    if (activeSince < this.prefs.activeGraceMinutes * 60 * 1000 && this.lastUserChatTimestamp > 0) return;

    // Do not interrupt during deep study / solving
    if (this.currentActivityState === 'DEEP_STUDY' || this.currentActivityState === 'SOLVING') return;

    const hasPending = this.pendingTriggers.some((t) => t.scheduledTime > now - 30 * 60 * 1000);
    if (hasPending) return;

    const relState = relationshipManager.getState();

    // Daytime Study Inactivity Check: If quiet for 2.5h to 18h during active daytime, check in naturally
    if (this.lastUserChatTimestamp > 0 && inactiveSince >= 2.5 * 3600 * 1000 && inactiveSince < 24 * 3600 * 1000) {
      const lastDaytimeNudge = relState.fatigue.topicCooldowns['inactivity_daytime'] || 0;
      if (now >= lastDaytimeNudge) {
        const msg = pickContextualMessage('inactivity_daytime', relState);
        const validation = validateProactiveDelivery(
          {
            id: 'inactivity_daytime',
            type: 'check_in',
            urgency: 0.6,
            relevance: 0.85,
            confidence: 0.9,
            freshness: 0.9,
            offlineText: msg,
            isInsideActiveSession: this.isUserCurrentlyInChat,
          },
          relState,
          {
            lastActiveTimestamp: this.lastActiveTimestamp,
            isInsideActiveSession: this.isUserCurrentlyInChat,
            recentSentMessages: relState.recentSentMessages,
            now,
          }
        );
        if (validation.valid) {
          this.injectMessageIntoChat(validation.sanitizedText || msg);
          relationshipManager.recordProactiveSent('inactivity_daytime', msg);
          return;
        }
      }
    }

    if (this.lastUserChatTimestamp > 0 && inactiveSince >= 96 * 3600 * 1000) {
      const msg = pickVariedTemplate('inactivity_96h', relState.recentSentMessages);
      const validation = validateProactiveDelivery(
        { id: 'inactivity_96h', type: 'check_in', urgency: 0.7, relevance: 0.8, confidence: 0.9, freshness: 0.9, offlineText: msg },
        relState,
        { lastActiveTimestamp: this.lastActiveTimestamp, recentSentMessages: relState.recentSentMessages, now }
      );
      if (validation.valid) {
        this.injectMessageIntoChat(validation.sanitizedText || msg);
        relationshipManager.recordProactiveSent('inactivity_96h', msg);
        this.lastUserChatTimestamp = now - 48 * 3600 * 1000;
      }
    } else if (this.lastUserChatTimestamp > 0 && inactiveSince >= 48 * 3600 * 1000) {
      const msg = pickVariedTemplate('inactivity_48h', relState.recentSentMessages);
      const validation = validateProactiveDelivery(
        { id: 'inactivity_48h', type: 'check_in', urgency: 0.6, relevance: 0.75, confidence: 0.85, freshness: 0.85, offlineText: msg },
        relState,
        { lastActiveTimestamp: this.lastActiveTimestamp, recentSentMessages: relState.recentSentMessages, now }
      );
      if (validation.valid) {
        this.injectMessageIntoChat(validation.sanitizedText || msg);
        relationshipManager.recordProactiveSent('inactivity_48h', msg);
      }
    } else if (this.lastUserChatTimestamp > 0 && inactiveSince >= 24 * 3600 * 1000) {
      const msg = pickVariedTemplate('inactivity_24h', relState.recentSentMessages);
      const validation = validateProactiveDelivery(
        { id: 'inactivity_24h', type: 'check_in', urgency: 0.5, relevance: 0.7, confidence: 0.8, freshness: 0.8, offlineText: msg },
        relState,
        { lastActiveTimestamp: this.lastActiveTimestamp, recentSentMessages: relState.recentSentMessages, now }
      );
      if (validation.valid) {
        this.injectMessageIntoChat(validation.sanitizedText || msg);
        relationshipManager.recordProactiveSent('inactivity_24h', msg);
      }
    }

    // ── Spontaneous Call Decision (Requirement 8) ────────────────────────────
    this.evaluateSpontaneousCall(now, relState);
  }

  private evaluateSpontaneousCall(now: number, relState: any): void {
    if (!this.prefs.callsEnabled || this.prefs.callFrequency === 'request_only') return;
    if (this.isQuietTime()) return;

    // Suppress spontaneous calls during active study or writing
    if (this.currentActivityState === 'DEEP_STUDY' || this.currentActivityState === 'SOLVING' || this.currentActivityState === 'WRITING') {
      return;
    }

    const minCallInterval = this.prefs.callFrequency === 'rare' ? 4 * 24 * 3600 * 1000 : 2 * 24 * 3600 * 1000;
    const declinePenaltyMs = (3 + this.consecutiveCallDeclines) * 24 * 3600 * 1000;
    const sevenDays = 7 * 24 * 3600 * 1000;

    const callReady =
      now - this.lastCallTimestamp > minCallInterval &&
      now - this.lastCallDeclinedTimestamp > declinePenaltyMs &&
      this.lastUserChatTimestamp > 0 &&
      now - this.lastUserChatTimestamp < sevenDays &&
      relState.fatigue.fatigueScore < 0.4;

    if (callReady) {
      // Conservative probability: 10% per tick
      if (Math.random() < 0.1) {
        const commitments = relState.commitments.filter((c: any) => c.state === 'PLANNED');
        const reason = commitments.length > 0 ? `${commitments[0].topic} study check-in` : 'Study check-in';
        this.triggerIncomingCall(reason);
      }
    }
  }

  recordUserActivity(): void {
    this.lastActiveTimestamp = Date.now();
    this.saveState();
  }

  setDNDDuration(durationMs: number): void {
    this.dndUntilTimestamp = Date.now() + durationMs;
    this.cancelAllPendingTriggers();
    this.saveState();
  }

  isQuietTime(): boolean {
    const now = new Date();
    if (Date.now() < this.dndUntilTimestamp) return true;

    try {
      const [startH, startM] = this.prefs.quietHoursStart.split(':').map(Number);
      const [endH, endM] = this.prefs.quietHoursEnd.split(':').map(Number);
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      if (startMins > endMins) {
        return currentMins >= startMins || currentMins < endMins;
      }
      return currentMins >= startMins && currentMins < endMins;
    } catch {
      return false;
    }
  }

  async cancelAllPendingTriggers(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        const ids = this.pendingTriggers.map((t) => ({ id: t.id }));
        if (ids.length > 0) {
          await LocalNotifications.cancel({ notifications: ids });
        }
      } catch (e) {
        console.warn('[ProactiveAgent] Cancel notifications error:', e);
      }
    }
    this.pendingTriggers = [];
    this.saveState();
  }

  async onTaskCompleted(taskId?: string, taskTitle?: string): Promise<void> {
    this.recordUserActivity();
    if (!taskId && !taskTitle) return;

    // Purge pending reminders matching this task
    const remaining: ProactiveTrigger[] = [];
    const toCancel: Array<{ id: number }> = [];
    const lowerTitle = (taskTitle || '').toLowerCase();

    for (const trig of this.pendingTriggers) {
      const matchTask = trig.relatedTaskId && trig.relatedTaskId === taskId;
      const matchTopic = trig.topic && lowerTitle.includes(trig.topic.toLowerCase());
      if (matchTask || matchTopic) {
        toCancel.push({ id: trig.id });
      } else {
        remaining.push(trig);
      }
    }

    if (toCancel.length > 0 && Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.cancel({ notifications: toCancel });
      } catch {}
    }

    this.pendingTriggers = remaining;
    this.saveState();

    if (taskTitle) {
      const comm = relationshipManager.findCommitmentByTopic(taskTitle);
      if (comm) {
        relationshipManager.updateCommitmentState(comm.id, 'COMPLETED');
      } else {
        relationshipManager.reinforceTopicSuccess(taskTitle);
      }

      const celebMsg = pickVariedTemplate('celebration', relationshipManager.getState().recentSentMessages);
      setTimeout(() => {
        this.injectMessageIntoChat(celebMsg);
      }, 800);
    }
  }

  onChatTurn(userText: string, assistantReply: string, context?: { tasksCount?: number; streak?: number }): void {
    if (!this.prefs.enabled) return;
    this.recordUserActivity();
    this.isUserCurrentlyInChat = true;

    // Clear ignoring state quietly without interrupting the active user turn with canned text
    relationshipManager.recordAppEngaged();

    this.lastUserChatTimestamp = Date.now();
    const lowerUser = userText.toLowerCase();

    // 1. DND intent check
    if (
      lowerUser.includes('disturb mat') ||
      lowerUser.includes('message mat karna') ||
      lowerUser.includes('call mat karna') ||
      lowerUser.includes('dnd')
    ) {
      let hours = 2;
      const match = lowerUser.match(/(\d+)\s*(?:ghante|ghanta|hour|hr)/);
      if (match) hours = parseInt(match[1], 10) || 2;
      this.setDNDDuration(hours * 3600 * 1000);
      return;
    }

    // 2. Explicit call request
    if (
      lowerUser.includes('call karo') ||
      lowerUser.includes('call pe aao') ||
      lowerUser.includes('call lagao') ||
      lowerUser.includes('mujhe call karo') ||
      lowerUser.includes('call me') ||
      lowerUser.includes('phone karo') ||
      lowerUser.includes('call karna') ||
      lowerUser.includes('mujhe call')
    ) {
      setTimeout(() => {
        this.triggerIncomingCall('User ne chat me call karne ko kaha');
      }, 1800);
      return;
    }

    // 3. Conversational promises
    if (
      lowerUser.includes('kal batata') ||
      lowerUser.includes('kal bataunga') ||
      lowerUser.includes('baad me batata') ||
      lowerUser.includes('baad me bataunga')
    ) {
      relationshipManager.addUserPromise(userText);
    }

    // 4. Commitments
    const hasCommitmentIntent =
      lowerUser.includes('kal ') ||
      lowerUser.includes('karega') ||
      lowerUser.includes('karunga') ||
      lowerUser.includes('questions lagane') ||
      lowerUser.includes('solve karna');

    if (hasCommitmentIntent) {
      const topicMatch = lowerUser.includes('optics')
        ? 'Optics'
        : lowerUser.includes('rotation')
        ? 'Rotation'
        : lowerUser.includes('organic')
        ? 'Organic Chemistry'
        : lowerUser.includes('thermo')
        ? 'Thermodynamics'
        : lowerUser.includes('calculus')
        ? 'Calculus'
        : 'JEE Problem Solving';

      const subjectMatch: SubjectArea =
        lowerUser.includes('optics') || lowerUser.includes('rotation') || lowerUser.includes('thermo')
          ? 'Physics'
          : lowerUser.includes('organic')
          ? 'Chemistry'
          : lowerUser.includes('calculus')
          ? 'Mathematics'
          : 'General';

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      relationshipManager.addCommitment({
        sourceText: userText,
        topic: topicMatch,
        subject: subjectMatch,
        targetDate: tomorrow.toISOString().slice(0, 10),
        state: 'PLANNED',
      });
    }

    // 5. Struggles & Mood
    if (
      lowerUser.includes('nahi samajh') ||
      lowerUser.includes('problem ho rahi') ||
      lowerUser.includes('doubt') ||
      lowerUser.includes('stuck')
    ) {
      const topicMatch = lowerUser.includes('optics')
        ? 'Optics'
        : lowerUser.includes('rotation')
        ? 'Rotation'
        : lowerUser.includes('organic')
        ? 'Organic Chemistry'
        : 'General Doubt';
      relationshipManager.addOrUpdateMemory('struggle', `Struggled with ${topicMatch}: "${userText.slice(0, 80)}"`, topicMatch);
    }

    if (lowerUser.includes('thak gaya') || lowerUser.includes('exhausted') || lowerUser.includes('demotivated') || lowerUser.includes('stress')) {
      relationshipManager.update((s) => {
        s.currentMoodContext = 'burnout';
      });
    }

    // ── 6. Debounced Session Seal (Requirement 1: Internal only, no instant visible message) ──
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.sealSessionTrigger(userText, assistantReply, context);
    }, 4000);

    // ── 7. 5-Minute In-Session Doubt Follow-Up (Requirement 1 & 2) ───────────
    if (this.sessionIdleTimer) {
      clearTimeout(this.sessionIdleTimer);
    }

    const topicForFollowUp = lowerUser.includes('optics')
      ? 'Optics'
      : lowerUser.includes('rotat') || lowerUser.includes('torque')
      ? 'Rotation'
      : lowerUser.includes('organic') || lowerUser.includes('reaction')
      ? 'Organic Chemistry'
      : lowerUser.includes('thermo')
      ? 'Thermodynamics'
      : lowerUser.includes('calculus') || lowerUser.includes('integrat')
      ? 'Calculus'
      : lowerUser.includes('doubt') || lowerUser.includes('nahi samajh')
      ? 'the doubt you had'
      : null;
    this.lastSessionTopic = topicForFollowUp || this.lastSessionTopic;

    this.sessionIdleTimer = setTimeout(() => {
      this.evaluateSessionFollowUp();
    }, 5 * 60 * 1000);
  }

  /**
   * Requirement 1: 4-Second Debounce Seal
   * ONLY seals session intent internally, updates graph, and schedules FUTURE background reminders.
   * NEVER sends an instant user-facing message into chat.
   */
  private async sealSessionTrigger(userText: string, _assistantReply: string, _context?: { tasksCount?: number; streak?: number }): Promise<void> {
    await this.cancelAllPendingTriggers();

    const lower = userText.toLowerCase();
    const now = Date.now();

    let delayMs = 1.5 * 3600 * 1000;
    let topic = 'jee_prep';
    let urgency = 0.6;
    let relevance = 0.8;
    let confidence = 0.85;

    if (lower.includes('optics') || lower.includes('ray diagram') || lower.includes('mirror') || lower.includes('lens')) {
      topic = 'optics';
      delayMs = 1.5 * 3600 * 1000;
      urgency = 0.8;
      relevance = 0.95;
    } else if (lower.includes('rotat') || lower.includes('torque') || lower.includes('moment of inertia')) {
      topic = 'rotation';
      delayMs = 3.5 * 3600 * 1000;
      urgency = 0.8;
      relevance = 0.95;
    } else if (lower.includes('organic') || lower.includes('reaction') || lower.includes('mechanism')) {
      topic = 'organic';
      delayMs = 2 * 3600 * 1000;
      urgency = 0.75;
      relevance = 0.9;
    } else if (lower.includes('thermo') || lower.includes('entropy') || lower.includes('enthalpy')) {
      topic = 'thermodynamics';
      delayMs = 3.5 * 3600 * 1000;
      urgency = 0.75;
      relevance = 0.9;
    } else if (lower.includes('calculus') || lower.includes('integration') || lower.includes('differential')) {
      topic = 'calculus';
      delayMs = 3.5 * 3600 * 1000;
      urgency = 0.8;
      relevance = 0.95;
    } else if (lower.includes('kal') || lower.includes('tomorrow') || lower.includes('subah')) {
      topic = 'morning_plan';
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 30, 0, 0);
      delayMs = Math.max(2 * 3600 * 1000, tomorrow.getTime() - now);
      urgency = 0.85;
      relevance = 0.9;
    } else if (lower.includes('thak') || lower.includes('tired') || lower.includes('demotivat') || lower.includes('stress')) {
      topic = 'rest_burnout';
      delayMs = 45 * 60 * 1000;
      urgency = 0.65;
      relevance = 0.85;
    }

    const relState = relationshipManager.getState();
    const offlineMessage = pickContextualMessage(topic, relState);
    const scheduledTime = now + delayMs;

    const candidate: ProactiveCandidate = {
      id: `cand_${now}`,
      type: 'commitment_followup',
      topic,
      urgency,
      relevance,
      confidence,
      freshness: 0.9,
      offlineText: offlineMessage,
    };

    const decision = socialDecisionEngine.shouldSpeak(
      candidate,
      relState,
      this.lastActiveTimestamp,
      scheduledTime,
      this.currentActivityState
    );
    if (!decision.allow) return;

    // Filter out prior pending triggers of same topic to avoid duplicate reminders
    this.pendingTriggers = this.pendingTriggers.filter((t) => t.topic !== topic);

    const triggerId = Math.floor(Math.random() * 100000) + 1000;
    const trigger: ProactiveTrigger = {
      id: triggerId,
      idempotencyKey: `${topic}:reminder:${new Date(scheduledTime).toISOString().slice(0, 10)}`,
      type: 'chat_nudge',
      scheduledTime,
      topic,
      offlineMessage,
    };

    this.pendingTriggers.push(trigger);
    this.saveState();
    // Note: recordProactiveSent is NOT called here — it is recorded upon ACTUAL message delivery!

    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: triggerId,
              title: 'Misa',
              body: offlineMessage,
              schedule: { at: new Date(scheduledTime), allowWhileIdle: true },
              channelId: 'misa_proactive_channel',
              extra: { offlineMessage, topic },
            },
          ],
        });
      } catch (err) {
        console.warn('[ProactiveAgent] Schedule notification error:', err);
      }
    }
  }

  /**
   * Requirement 1 & 2: 5-Minute In-Session Doubt Follow-Up
   * Evaluated strictly inside the active in-app chat session.
   * If user left the app, global 30-minute grace suppresses background notifications.
   */
  evaluateSessionFollowUp(overrideNow?: number): void {
    if (this.isQuietTime()) return;

    const now = overrideNow ?? Date.now();
    // Must be in chat and silent for >= 4.5 minutes
    if (now - this.lastUserChatTimestamp < 4.5 * 60 * 1000 && !overrideNow) return;

    const rel = relationshipManager.getState();
    const topic = this.lastSessionTopic || rel.commitments[0]?.topic || rel.currentSubject || null;

    const followUpMessages = topic
      ? [
          `Ek kaam aur batao — ${topic} ka jo section chal raha tha, koi step clear nahi tha kya? 😊`,
          `Hey, ${topic} wala part kaisa raha? Kuch aur sambhalna ho toh batao! 🎯`,
          `Suno, ${topic} me koi formula ya concept dobara dekhna ho toh batao, saath me kar lete hain 💪`,
        ]
      : [
          'Koi aur question chal raha hai? Batao, saath me solve karte hain! 😊',
          'Hey, padhai kaisi chal rahi hai? Koi concept fasa hua ho toh batao! 🎯',
          'Suno, agar koi doubt hai toh abhi puch lo — main available hoon! 💪',
        ];

    const sentMsgs = rel.recentSentMessages;
    const available = followUpMessages.filter((m) => !sentMsgs.includes(m));
    const msg = available[Math.floor(Math.random() * available.length)] || followUpMessages[0];

    const candidate: ProactiveCandidate = {
      id: `session_followup_${now}`,
      type: 'session_followup',
      topic: topic || undefined,
      urgency: 0.7,
      relevance: 0.9,
      confidence: 0.85,
      freshness: 0.95,
      offlineText: msg,
      isInsideActiveSession: this.isUserCurrentlyInChat,
    };

    // Run through behavior validation layer
    const validation = validateProactiveDelivery(candidate, rel, {
      lastActiveTimestamp: this.lastActiveTimestamp,
      isInsideActiveSession: this.isUserCurrentlyInChat,
      recentSentMessages: rel.recentSentMessages,
      now,
    });

    if (!validation.valid) return;

    const decision = socialDecisionEngine.shouldSpeak(
      candidate,
      rel,
      this.lastActiveTimestamp,
      now,
      this.currentActivityState
    );

    if (decision.allow) {
      this.injectMessageIntoChat(validation.sanitizedText || msg);
      relationshipManager.recordProactiveSent('session_followup', msg);
    }
  }

  private async checkColdStartOnboarding(): Promise<void> {
    if (this.lastUserChatTimestamp > 0) return;

    const now = Date.now();
    const day1Time = new Date();
    day1Time.setHours(18, 30, 0, 0);
    if (day1Time.getTime() < now) {
      day1Time.setDate(day1Time.getDate() + 1);
    }

    const trigger: ProactiveTrigger = {
      id: 9901,
      type: 'cold_start',
      scheduledTime: day1Time.getTime(),
      offlineMessage: 'Hey! Dekha tumne LevelUp install kiya hai par abhi tak baat nahi ki. JEE prep me kya target chal raha hai — milke plan banayein?',
    };

    this.pendingTriggers.push(trigger);
    this.saveState();

    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: 9901,
              title: 'Misa',
              body: trigger.offlineMessage,
              schedule: { at: day1Time, allowWhileIdle: true },
              channelId: 'misa_proactive_channel',
              extra: { offlineMessage: trigger.offlineMessage },
            },
          ],
        });
      } catch {}
    }
  }

  triggerIncomingCall(reason = 'Study check-in'): void {
    if (!this.prefs.callsEnabled) return;
    if (this.isQuietTime()) return;

    const now = Date.now();
    const minCallInterval = this.prefs.callFrequency === 'rare' ? 4 * 24 * 3600 * 1000 : 2 * 24 * 3600 * 1000;
    const declinePenaltyMs = (3 + this.consecutiveCallDeclines) * 24 * 3600 * 1000;

    if (now - this.lastCallDeclinedTimestamp < declinePenaltyMs && !reason.includes('User ne')) {
      return;
    }
    if (now - this.lastCallTimestamp < minCallInterval && !reason.includes('User ne')) {
      return;
    }

    this.lastCallTimestamp = now;
    this.saveState();

    const callEvent: IncomingCallEvent = {
      callId: `call_${now}`,
      reason,
      callerName: 'Misa',
    };

    for (const listener of this.incomingCallListeners) {
      listener(callEvent);
    }
  }

  onCallAccepted(_callId: string): void {
    this.lastActiveTimestamp = Date.now();
    this.consecutiveCallDeclines = 0; // Reset decline penalty on successful call
    this.saveState();
  }

  onCallDeclined(_callId: string): void {
    this.lastCallDeclinedTimestamp = Date.now();
    this.consecutiveCallDeclines += 1;
    this.saveState();
    this.injectCallStatusEvent('declined');
  }

  onCallMissed(_callId: string): void {
    this.saveState();
    this.injectCallStatusEvent('missed');
    setTimeout(() => {
      this.injectMessageIntoChat('Hii, suno? Padh rahe the kya? Free hoke text karna!');
    }, 90 * 1000);
  }

  /**
   * Requirement 9: Distinguish Offline Call Attempt from Missed Call
   */
  onOfflineCallAttempt(_callId: string, reason = 'Scheduled study check-in'): void {
    this.saveState();
    this.injectCallStatusEvent('offline_attempt');
    setTimeout(() => {
      this.injectMessageIntoChat(`Hii, ${reason} ke liye call plan ki thi par network unreachable tha. Jab online aao toh batana! 📶`);
    }, 1000);
  }

  injectMessageIntoChat(text: string): void {
    for (const listener of this.messageInjectionListeners) {
      listener({ role: 'assistant', text, isProactive: true });
    }
  }

  private injectCallStatusEvent(callStatus: CallStatusType): void {
    let displayText = '📞 Call Event';
    if (callStatus === 'missed') displayText = '📞 Missed Call';
    else if (callStatus === 'declined') displayText = '📞 Declined Call';
    else if (callStatus === 'offline_attempt') displayText = '📶 Offline Call Attempt';

    for (const listener of this.messageInjectionListeners) {
      listener({
        role: 'assistant',
        text: displayText,
        isCallEvent: true,
        callStatus,
      });
    }
  }

  onIncomingCall(listener: IncomingCallListener): () => void {
    this.incomingCallListeners.add(listener);
    return () => this.incomingCallListeners.delete(listener);
  }

  onMessageInjection(listener: MessageInjectionListener): () => void {
    this.messageInjectionListeners.add(listener);
    return () => this.messageInjectionListeners.delete(listener);
  }

  resetForTesting(): void {
    this.prefs = { ...DEFAULT_PROACTIVE_PREFS };
    this.lastActiveTimestamp = Date.now();
    this.lastUserChatTimestamp = 0;
    this.lastCallTimestamp = 0;
    this.lastCallDeclinedTimestamp = 0;
    this.consecutiveCallDeclines = 0;
    this.dndUntilTimestamp = 0;
    this.pendingTriggers = [];
    this.lastSessionTopic = null;
    this.isUserCurrentlyInChat = false;
    this.currentActivityState = 'IDLE';
    relationshipManager.update((s) => {
      s.boundaries.quietHoursStart = '03:00';
      s.boundaries.quietHoursEnd = '06:00';
    });
    this.saveState();
  }
}

export const proactiveAgentService = new ProactiveAgentService();
