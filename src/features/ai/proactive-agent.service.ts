/**
 * Misa Autonomous Proactive Agent Service
 * Handles:
 * - 100% Offline & Online Proactive Messaging & Notifications
 * - Cold-Start Onboarding (Zero-chat day 1/2/3 triggers)
 * - Time-less Context Follow-ups (Optics, struggles, next-day plans)
 * - Task-activity Recognition (Silent hardworking student praise)
 * - Inactivity Re-engagement (24h, 48h, 96h)
 * - Anti-Distraction Shield (30-min active grace period)
 * - Single-Slot Debounced Session Seal
 * - Instant Pre-Flight Task Invalidation
 * - WhatsApp-Style Incoming Live Calls (Explicit, Scheduled & Spontaneous)
 * - Instant DND Cancellation Shield
 * - Message Retraction / Self-Correction Anti-Loop Guards
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { RingtonePresetId } from '../../lib/ringtone-player';
import { relationshipManager, type SubjectArea } from './relationship-state';
import { socialDecisionEngine, type ProactiveCandidate } from './social-decision-engine';

export interface ProactivePreferences {
  enabled: boolean;
  callsEnabled: boolean;
  callFrequency: 'rare' | 'balanced' | 'request_only'; // rare = 1 call/4d, balanced = 1 call/2d, request_only = only when user asks
  quietHoursStart: string; // e.g. "22:30" (10:30 PM)
  quietHoursEnd: string;   // e.g. "07:30" (7:30 AM)
  ringtonePreset: RingtonePresetId;
  customRingtoneUrl?: string;
  activeGraceMinutes: number; // default: 30 minutes
}

export const DEFAULT_PROACTIVE_PREFS: ProactivePreferences = {
  enabled: true,
  callsEnabled: true,
  callFrequency: 'balanced',
  quietHoursStart: '22:30',
  quietHoursEnd: '07:30',
  ringtonePreset: 'soft_chime',
  activeGraceMinutes: 30,
};

export interface ProactiveTrigger {
  id: number;
  type: 'chat_nudge' | 'incoming_call' | 'inactivity' | 'cold_start';
  scheduledTime: number; // epoch ms
  topic?: string;
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
export type MessageInjectionListener = (message: { role: 'assistant'; text: string; isProactive?: boolean; isCallEvent?: boolean; callStatus?: string }) => void;

const DYNAMIC_TEMPLATES: Record<string, string[]> = {
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

class ProactiveAgentService {
  private prefs: ProactivePreferences = { ...DEFAULT_PROACTIVE_PREFS };
  private lastActiveTimestamp = Date.now();
  private lastUserChatTimestamp = 0;
  private lastCallTimestamp = 0;
  private lastCallDeclinedTimestamp = 0;
  private dndUntilTimestamp = 0;
  private pendingTriggers: ProactiveTrigger[] = [];
  private debounceTimer: any = null;
  private incomingCallListeners: Set<IncomingCallListener> = new Set();
  private messageInjectionListeners: Set<MessageInjectionListener> = new Set();
  private isInitialized = false;

  constructor() {
    this.loadState();
  }

  /** Reset internal state for testing */
  resetForTesting(): void {
    this.prefs = { ...DEFAULT_PROACTIVE_PREFS };
    this.pendingTriggers = [];
    this.lastActiveTimestamp = Date.now();
    this.lastUserChatTimestamp = 0;
    this.lastCallTimestamp = 0;
    this.lastCallDeclinedTimestamp = 0;
    this.dndUntilTimestamp = 0;
    relationshipManager.resetForTesting();
  }

  private loadState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const savedPrefs = localStorage.getItem('misa_proactive_prefs');
      if (savedPrefs) {
        this.prefs = { ...DEFAULT_PROACTIVE_PREFS, ...JSON.parse(savedPrefs) };
      }
      const savedState = localStorage.getItem('misa_proactive_state');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        this.lastActiveTimestamp = parsed.lastActiveTimestamp || Date.now();
        this.lastUserChatTimestamp = parsed.lastUserChatTimestamp || 0;
        this.lastCallTimestamp = parsed.lastCallTimestamp || 0;
        this.lastCallDeclinedTimestamp = parsed.lastCallDeclinedTimestamp || 0;
        this.dndUntilTimestamp = parsed.dndUntilTimestamp || 0;
        this.pendingTriggers = parsed.pendingTriggers || [];
      }
    } catch (e) {
      console.warn('[ProactiveAgent] Failed to load state:', e);
    }
  }

  private saveState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('misa_proactive_prefs', JSON.stringify(this.prefs));
      localStorage.setItem(
        'misa_proactive_state',
        JSON.stringify({
          lastActiveTimestamp: this.lastActiveTimestamp,
          lastUserChatTimestamp: this.lastUserChatTimestamp,
          lastCallTimestamp: this.lastCallTimestamp,
          lastCallDeclinedTimestamp: this.lastCallDeclinedTimestamp,
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

  updatePreferences(partial: Partial<ProactivePreferences>): void {
    this.prefs = { ...this.prefs, ...partial };
    this.saveState();
  }

  onIncomingCall(listener: IncomingCallListener): () => void {
    this.incomingCallListeners.add(listener);
    return () => this.incomingCallListeners.delete(listener);
  }

  onMessageInjection(listener: MessageInjectionListener): () => void {
    this.messageInjectionListeners.add(listener);
    return () => this.messageInjectionListeners.delete(listener);
  }

  /** Initialize notification channels & listeners on app start */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.recordUserActivity();

    // Create high-importance Android Notification Channel
    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.createChannel({
          id: 'misa_proactive_channel',
          name: 'Misa JEE Study Partner',
          description: 'Spontaneous check-ins, study nudges, and calls from Misa',
          importance: 5, // IMPORTANCE_HIGH
          visibility: 1,
          vibration: true,
          sound: 'res_custom_notification',
        });

        // Request permissions if needed
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }

        // Listen for notification taps
        LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
          const extra = notificationAction.notification.extra;
          if (extra?.offlineMessage) {
            this.injectMessageIntoChat(extra.offlineMessage);
          }
        });
      } catch (err) {
        console.warn('[ProactiveAgent] LocalNotifications setup failed:', err);
      }
    }

    // Check cold-start triggers on first launch
    this.checkColdStartOnboarding();
  }

  /** Record any user activity in app (resets 30-min anti-distraction shield) */
  recordUserActivity(): void {
    this.lastActiveTimestamp = Date.now();
    this.saveState();
  }

  /** Set DND Shield (e.g. "Misa 2 ghante disturb mat karna") */
  setDNDDuration(durationMs: number): void {
    this.dndUntilTimestamp = Date.now() + durationMs;
    this.cancelAllPendingTriggers();
    this.saveState();
  }

  /** Checks if the current time falls in Quiet Hours or DND window */
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
        // Overnight quiet hours (e.g. 22:30 -> 07:30)
        return currentMins >= startMins || currentMins < endMins;
      }
      return currentMins >= startMins && currentMins < endMins;
    } catch {
      return false;
    }
  }

  /** Cancels all pending alarms & triggers */
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

  /** Hook: Triggered when user marks a task completed in the app */
  async onTaskCompleted(taskId?: string, taskTitle?: string): Promise<void> {
    this.recordUserActivity();
    if (!taskId && !taskTitle) return;

    // Invalidate any pending trigger that referenced this task or topic
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

    // Update Relationship State & Commitments Graph
    if (taskTitle) {
      const comm = relationshipManager.findCommitmentByTopic(taskTitle);
      if (comm) {
        relationshipManager.updateCommitmentState(comm.id, 'COMPLETED');
      } else {
        relationshipManager.reinforceTopicSuccess(taskTitle);
      }
      // Natural companion celebration on accomplishment
      const celebMsg = pickVariedTemplate('celebration', relationshipManager.getState().recentSentMessages);
      setTimeout(() => {
        this.injectMessageIntoChat(celebMsg);
      }, 800);
    }
  }

  /** Hook: Triggered on every conversation turn in Chat */
  onChatTurn(userText: string, assistantReply: string, context?: { tasksCount?: number; streak?: number }): void {
    if (!this.prefs.enabled) return;
    this.recordUserActivity();
    const { wasIgnoring, pendingPromise } = relationshipManager.recordAppEngaged();
    if (wasIgnoring) {
      setTimeout(() => {
        if (pendingPromise) {
          this.injectMessageIntoChat('Acha mil gaye aap 😭 waise kal wali baat ab bataoge? 😏');
        } else {
          this.injectMessageIntoChat('Acha mil gaye aap 😭 kya chal raha tha?');
        }
      }, 1200);
    }

    this.lastUserChatTimestamp = Date.now();

    const lowerUser = userText.toLowerCase();

    // 1. Check for DND intent
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

    // 2. Check for explicit call request ("Misa call karo" / "Call pe aao")
    if (
      lowerUser.includes('call karo') ||
      lowerUser.includes('call pe aao') ||
      lowerUser.includes('call lagao') ||
      lowerUser.includes('mujhe call karo')
    ) {
      setTimeout(() => {
        this.triggerIncomingCall('User ne chat me call karne ko kaha');
      }, 1800);
      return;
    }

    // 3. Check for conversational promises ("kal batata hu", "baad me bataunga")
    if (
      lowerUser.includes('kal batata') ||
      lowerUser.includes('kal bataunga') ||
      lowerUser.includes('baad me batata') ||
      lowerUser.includes('baad me bataunga')
    ) {
      relationshipManager.addUserPromise(userText);
    }

    // 4. Extract & Register Commitments ("kal optics karunga", "questions solve karne hain")
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

    // 4. Extract & Register Durable Struggles
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

    // 5. Extract Mood / Burnout context
    if (lowerUser.includes('thak gaya') || lowerUser.includes('exhausted') || lowerUser.includes('demotivated') || lowerUser.includes('stress')) {
      relationshipManager.update((s) => {
        s.currentMoodContext = 'burnout';
      });
    }

    // 6. Debounced Session Seal (Single-Slot Architecture)
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.sealSessionTrigger(userText, assistantReply, context);
    }, 4000);
  }

  /** Evaluates final session intent and sets a SINGLE, highest-priority trigger */
  private async sealSessionTrigger(userText: string, _assistantReply: string, _context?: { tasksCount?: number; streak?: number }): Promise<void> {
    // Purge old chat_nudge triggers (Single-slot rule)
    await this.cancelAllPendingTriggers();

    const lower = userText.toLowerCase();
    const now = Date.now();

    let delayMs = 3.5 * 3600 * 1000; // default: 3.5 hours
    let topic = 'jee_prep';
    let offlineMessage = 'Suno, question solving chal rahi hai na? Koi calculation me doubt ho to batana!';
    let triggerType: 'chat_nudge' | 'incoming_call' = 'chat_nudge';
    let urgency = 0.6;
    let relevance = 0.8;
    let confidence = 0.85;

    // Topic & Intent extraction heuristics
    if (lower.includes('optics') || lower.includes('ray diagram') || lower.includes('mirror') || lower.includes('lens')) {
      topic = 'optics';
      delayMs = 3.5 * 3600 * 1000;
      urgency = 0.8;
      relevance = 0.95;
    } else if (lower.includes('rotat') || lower.includes('torque') || lower.includes('moment of inertia')) {
      topic = 'rotation';
      delayMs = 3.5 * 3600 * 1000;
      urgency = 0.8;
      relevance = 0.95;
    } else if (lower.includes('organic') || lower.includes('reaction') || lower.includes('mechanism')) {
      topic = 'organic';
      delayMs = 4 * 3600 * 1000;
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
      // Next day morning intent -> schedule around 9:30 AM tomorrow
      topic = 'morning_plan';
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 30, 0, 0);
      delayMs = Math.max(2 * 3600 * 1000, tomorrow.getTime() - now);
      urgency = 0.85;
      relevance = 0.9;
    } else if (lower.includes('thak') || lower.includes('tired') || lower.includes('demotivat') || lower.includes('stress')) {
      topic = 'rest_burnout';
      delayMs = 5 * 3600 * 1000;
      urgency = 0.65;
      relevance = 0.85;
    } else if (lower.includes('raat bhar') || lower.includes('late night') || lower.includes('raat ko padh')) {
      // S31: Multi-day pattern check (only fires if user has 2+ consecutive late-night sessions)
      if (relationshipManager.getState().lateNightStreak >= 2) {
        topic = 'late_night_pattern';
        delayMs = 6 * 3600 * 1000;
        urgency = 0.7;
        relevance = 0.9;
      }
    }

    // Pick dynamic non-repetitive message from template matrix
    offlineMessage = pickVariedTemplate(topic, relationshipManager.getState().recentSentMessages);

    const scheduledTime = now + delayMs;

    // Social Decision Engine Check: "Kya mujhe bolna chahiye?"
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

    const decision = socialDecisionEngine.shouldSpeak(candidate, relationshipManager.getState(), this.lastActiveTimestamp, scheduledTime);
    if (!decision.allow) {
      return; // Suppressed gracefully by social engine (DND, Quiet hours, or Fatigue)
    }

    const triggerId = Math.floor(Math.random() * 100000) + 1000;
    const trigger: ProactiveTrigger = {
      id: triggerId,
      type: triggerType,
      scheduledTime,
      topic,
      offlineMessage,
    };

    this.pendingTriggers.push(trigger);
    this.saveState();
    relationshipManager.recordProactiveSent(topic, offlineMessage);

    // Schedule Android hardware alarm via LocalNotifications
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

  /** Checks & schedules Day 1/2/3 onboarding triggers if zero chat history exists */
  private async checkColdStartOnboarding(): Promise<void> {
    if (this.lastUserChatTimestamp > 0) return; // Not cold start

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

  /** Trigger an incoming WhatsApp-style live call */
  triggerIncomingCall(reason = 'Study check-in'): void {
    if (!this.prefs.callsEnabled) return;
    if (this.isQuietTime()) return;

    // Check anti-spam calling limits
    const now = Date.now();
    const minCallInterval = this.prefs.callFrequency === 'rare' ? 4 * 24 * 3600 * 1000 : 2 * 24 * 3600 * 1000;
    if (now - this.lastCallDeclinedTimestamp < 3 * 24 * 3600 * 1000 && !reason.includes('User ne')) {
      return; // Declined cooldown
    }
    if (now - this.lastCallTimestamp < minCallInterval && !reason.includes('User ne')) {
      return; // Frequency cooldown
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

  /** Handle call accepted */
  onCallAccepted(_callId: string): void {
    this.lastActiveTimestamp = Date.now();
    this.saveState();
  }

  /** Handle call declined by user */
  onCallDeclined(_callId: string): void {
    this.lastCallDeclinedTimestamp = Date.now();
    this.saveState();

    // Inject WhatsApp-style declined message into chat
    this.injectCallStatusEvent('declined');
  }

  /** Handle call missed / unanswered after 30s timeout */
  onCallMissed(_callId: string): void {
    this.saveState();

    // 1. Inject Missed Call badge
    this.injectCallStatusEvent('missed');

    // 2. Schedule natural 1.5 min follow-up message from Misa
    setTimeout(() => {
      this.injectMessageIntoChat('Hii, suno? Padh rahe the kya? Free hoke text karna!');
    }, 90 * 1000);
  }

  /** Injects a message into the active conversation thread */
  injectMessageIntoChat(text: string): void {
    for (const listener of this.messageInjectionListeners) {
      listener({ role: 'assistant', text, isProactive: true });
    }
  }

  /** Injects a call card into chat */
  private injectCallStatusEvent(callStatus: 'accepted' | 'declined' | 'missed'): void {
    for (const listener of this.messageInjectionListeners) {
      listener({
        role: 'assistant',
        text: callStatus === 'missed' ? '📞 Missed Call' : '📞 Declined Call',
        isCallEvent: true,
        callStatus,
      });
    }
  }
}

export const proactiveAgentService = new ProactiveAgentService();
