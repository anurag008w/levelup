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
import { isAppActive } from '../../lib/notifications';
import { container } from '../../di/container';
import { isLiveCallActive } from './live-call-state';
import type { LiveCallOrigin } from '../../core/domain/live-types';

export interface ProactivePreferences {
  enabled: boolean;
  callsEnabled: boolean;
  callFrequency: 'rare' | 'balanced' | 'request_only';
  quietHoursStart: string;
  quietHoursEnd: string;
  ringtonePreset: RingtonePresetId;
  customRingtoneUrl?: string;
  activeGraceMinutes: number;
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

export type CallStatusType = 'accepted' | 'declined' | 'missed' | 'offline_attempt' | 'timeout';

export interface ProactiveTrigger {
  id: number;
  idempotencyKey?: string;
  type: 'chat_nudge' | 'incoming_call' | 'inactivity' | 'cold_start' | 'session_followup';
  scheduledTime: number;
  topic?: string;
  intent?: 'reminder' | 'doubt_followup' | 'urgent_check' | 'recap' | 'general';
  relatedTaskId?: string;
  offlineMessage: string;
  callReason?: string;
  requiresOnline?: boolean;
}

/** AI tools (scheduleMessage/makeCall) se banaya gaya scheduled item. */
export interface ScheduledProactiveMessage {
  id: string;
  kind: 'message' | 'call';
  text?: string;
  reason?: string;
  scheduledTime: number;
  topic?: string;
  createdAt: number;
  linkedEntity?: { type: 'todo' | 'task' | 'memory' | 'keyword'; value: string };
  cancelled?: boolean;
  deliveryRetries?: number;
}

export interface MisaProactiveBlob {
  prefs: ProactivePreferences;
  lastActiveTimestamp: number;
  lastUserChatTimestamp: number;
  lastCallTimestamp: number;
  lastCallDeclinedTimestamp: number;
  consecutiveCallDeclines: number;
  dndUntilTimestamp: number;
  coldStartDone: boolean;
  pendingTriggers: ProactiveTrigger[];
  scheduledMessages: ScheduledProactiveMessage[];
  missedInteractions: Array<{ kind: 'call' | 'message'; at: number; detail: string; followedUpAt: number | null }>;
}

export interface IncomingCallEvent {
  callId: string;
  reason: string;
  callerName: string;
  avatarUrl?: string;
  origin?: LiveCallOrigin;
}

export type IncomingCallListener = (event: IncomingCallEvent) => void;

export interface MessageInjectionPayload {
  role: 'assistant';
  text: string;
  isProactive?: boolean;
  isCallEvent?: boolean;
  callStatus?: CallStatusType;
  msgId?: string;
}

export type MessageInjectionListener = (message: MessageInjectionPayload) => void | boolean;

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
  const commitment = relState?.commitments?.find((c: any) => c.state === "PLANNED");
  if (commitment && Math.random() < 0.45) {
    const commMsgs = [
      `Suno! Aaj ${commitment.topic} ka session plan tha na? Shuru kiya ya koi numerical fasa hai? 💪`,
      `Hey! ${commitment.topic} ke pyqs solve karne the na aaj? Kaisa chal raha hai progress? 🎯`,
      `${commitment.topic} wala target start hua? Batana agar koi concept dubara recall karna ho! 😊`,
    ];
    const availableComm = commMsgs.filter((m) => !recentSent.includes(m));
    if (availableComm.length > 0) return availableComm[Math.floor(Math.random() * availableComm.length)];
  }
  if (relState?.currentProblemArea && Math.random() < 0.35) {
    const struggleMsgs = [
      `Woh ${relState.currentProblemArea} wala doubt clear ho gaya tha ya abhi bhi tricky lag raha hai? 💡`,
      `Suno, ${relState.currentProblemArea} me koi specific formula ya step dubara dekhna ho toh batana, saath me kar lenge! 🤝`,
    ];
    const availableStruggle = struggleMsgs.filter((m) => !recentSent.includes(m));
    if (availableStruggle.length > 0) return availableStruggle[Math.floor(Math.random() * availableStruggle.length)];
  }
  const promise = relState?.pendingPromises?.find((p: any) => !p.isResumed);
  if (promise && Math.random() < 0.4) return `Hey! Bol rahe the na baad me bataoge — ab batao kaisa raha target? 😏`;
  return pickVariedTemplate(topic, recentSent);
}

const STORAGE_KEY = 'misa_proactive_agent_prefs_v2';

class ProactiveAgentService {
  private prefs: ProactivePreferences = { ...DEFAULT_PROACTIVE_PREFS };
  private lastActiveTimestamp = Date.now();
  private lastUserChatTimestamp = 0;
  private lastTypingPersistAt = 0;
  private lastCallTimestamp = 0;
  private lastCallDeclinedTimestamp = 0;
  private lastUserToolCallTimestamp = 0;
  private consecutiveCallDeclines = 0;
  private dndUntilTimestamp = 0;
  private coldStartDone = false;
  private pendingTriggers: ProactiveTrigger[] = [];
  private debounceTimer: any = null;
  private sessionIdleTimer: any = null;
  private celebrationTimer: any = null;
  private chatCallTimer: any = null;
  private missedCallTimer: any = null;
  private offlineCallTimer: any = null;
  private inactivityCheckInFlight = false;
  private lastSessionTopic: string | null = null;
  private isUserCurrentlyInChat = false;
  /** True only while a user-initiated chat turn is actively being generated. */
  private userTurnInFlight = false;
  /** True only while the 5-minute session-idle callback is evaluating its in-session follow-up. */
  private sessionFollowUpInFlight = false;
  private currentActivityState: UserActivityState = 'IDLE';
  private incomingCallListeners: Set<IncomingCallListener> = new Set();
  private messageInjectionListeners: Set<MessageInjectionListener> = new Set();
  private platformInitialized = false;
  private platformIntervals: ReturnType<typeof setInterval>[] = [];
  private platformTimeout: ReturnType<typeof setTimeout> | null = null;
  private platformActionListener: (() => void) | null = null;
  private recentInjected: Map<string, number> = new Map();
  private static readonly INJECT_DEDUPE_WINDOW_MS = 3 * 60 * 1000;
  private static readonly MAX_DELIVERY_RETRIES = 3;
  private nextSpontaneousAt = 0;
  private static readonly SPONTANEOUS_MIN_GAP_MS = 45 * 60 * 1000;
  private missedInteractions: Array<{ kind: 'call' | 'message'; at: number; detail: string; followedUpAt: number | null }> = [];
  private static readonly MISSED_FOLLOWUP_GRACE_MS = 2 * 60 * 60 * 1000;
  private static readonly MISSED_FOLLOWUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  private scheduledMessages: ScheduledProactiveMessage[] = [];
  private onChange: (() => void) | null = null;

  constructor() { this.loadState(); this.initPlatformNotifications(); }
  setOnChange(fn: (() => void) | null): void { this.onChange = fn; }
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
        this.coldStartDone = parsed.coldStartDone || false;
        this.pendingTriggers = parsed.pendingTriggers || [];
        this.scheduledMessages = parsed.scheduledMessages || [];
        this.missedInteractions = parsed.missedInteractions || [];
      }
    } catch (e) { console.warn('[ProactiveAgent] Failed to load preferences:', e); }
  }
  private saveState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        prefs: this.prefs,
        lastActiveTimestamp: this.lastActiveTimestamp,
        lastUserChatTimestamp: this.lastUserChatTimestamp,
        lastCallTimestamp: this.lastCallTimestamp,
        lastCallDeclinedTimestamp: this.lastCallDeclinedTimestamp,
        consecutiveCallDeclines: this.consecutiveCallDeclines,
        dndUntilTimestamp: this.dndUntilTimestamp,
        coldStartDone: this.coldStartDone,
        pendingTriggers: this.pendingTriggers,
        scheduledMessages: this.scheduledMessages,
        missedInteractions: this.missedInteractions,
      }));
      this.onChange?.();
    } catch (e) { console.warn('[ProactiveAgent] Failed to save state:', e); }
  }
  getSyncBlob(): MisaProactiveBlob {
    return { prefs: { ...this.prefs }, lastActiveTimestamp: this.lastActiveTimestamp, lastUserChatTimestamp: this.lastUserChatTimestamp, lastCallTimestamp: this.lastCallTimestamp, lastCallDeclinedTimestamp: this.lastCallDeclinedTimestamp, consecutiveCallDeclines: this.consecutiveCallDeclines, dndUntilTimestamp: this.dndUntilTimestamp, coldStartDone: this.coldStartDone, pendingTriggers: this.pendingTriggers.map((t) => ({ ...t })), scheduledMessages: this.scheduledMessages.map((s) => ({ ...s })), missedInteractions: this.missedInteractions.map((m) => ({ ...m })) };
  }
  replaceFromSync(blob: Partial<MisaProactiveBlob>): void {
    this.prefs = { ...DEFAULT_PROACTIVE_PREFS, ...(blob.prefs || {}) };
    this.lastActiveTimestamp = blob.lastActiveTimestamp || Date.now();
    this.lastUserChatTimestamp = blob.lastUserChatTimestamp || 0;
    this.lastCallTimestamp = blob.lastCallTimestamp || 0;
    this.lastCallDeclinedTimestamp = blob.lastCallDeclinedTimestamp || 0;
    this.consecutiveCallDeclines = blob.consecutiveCallDeclines || 0;
    this.dndUntilTimestamp = blob.dndUntilTimestamp || 0;
    this.coldStartDone = Boolean(blob.coldStartDone);
    this.pendingTriggers = Array.isArray(blob.pendingTriggers) ? blob.pendingTriggers : [];
    this.scheduledMessages = Array.isArray(blob.scheduledMessages) ? blob.scheduledMessages : [];
    this.missedInteractions = Array.isArray(blob.missedInteractions) ? blob.missedInteractions : [];
    this.saveState();
  }
  getPreferences(): ProactivePreferences { return { ...this.prefs }; }
  updatePreferences(patch: Partial<ProactivePreferences>): void {
    this.prefs = { ...this.prefs, ...patch };
    if (patch.enabled === false) { void this.cancelAllPendingTriggers(); ringtonePlayer.stop(); this.pendingTriggers = []; this.scheduledMessages = this.scheduledMessages.filter((s) => s.kind === 'call'); }
    if (patch.callsEnabled === false) { this.pendingTriggers = this.pendingTriggers.filter((t) => t.type !== 'incoming_call'); this.scheduledMessages = this.scheduledMessages.filter((s) => s.kind !== 'call'); ringtonePlayer.stop(); }
    if (patch.quietHoursStart || patch.quietHoursEnd || patch.activeGraceMinutes) relationshipManager.update((s) => { if (patch.quietHoursStart) s.boundaries.quietHoursStart = patch.quietHoursStart; if (patch.quietHoursEnd) s.boundaries.quietHoursEnd = patch.quietHoursEnd; if (patch.activeGraceMinutes !== undefined) s.boundaries.activeGraceMinutes = patch.activeGraceMinutes; });
    this.saveState();
  }
  setUserActivityState(state: UserActivityState): void { this.currentActivityState = state; }
  /** Called synchronously before the LLM request starts so proactive timers cannot race the turn. */
  beginChatTurn(): void {
    this.userTurnInFlight = true;
    this.isUserCurrentlyInChat = true;
    this.recordUserActivity();
    this.lastUserChatTimestamp = Date.now();
    if (this.sessionIdleTimer !== null) {
      clearTimeout(this.sessionIdleTimer);
      this.sessionIdleTimer = null;
    }
  }
  /** Called when a user turn is aborted/failed without an assistant response. */
  cancelChatTurn(): void {
    this.userTurnInFlight = false;
    this.isUserCurrentlyInChat = false;
    if (this.sessionIdleTimer !== null) {
      clearTimeout(this.sessionIdleTimer);
      this.sessionIdleTimer = null;
    }
  }
  setInChatSession(inChat: boolean): void { this.isUserCurrentlyInChat = inChat; if (inChat) this.recordUserActivity(); }
  async init(): Promise<void> { await this.initPlatformNotifications(); }
  destroy(): void {
    for (const id of this.platformIntervals) clearInterval(id);
    this.platformIntervals = [];
    if (this.platformTimeout !== null) { clearTimeout(this.platformTimeout); this.platformTimeout = null; }
    if (this.debounceTimer !== null) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.sessionIdleTimer !== null) { clearTimeout(this.sessionIdleTimer); this.sessionIdleTimer = null; }
    for (const t of [this.celebrationTimer, this.chatCallTimer, this.missedCallTimer, this.offlineCallTimer]) if (t !== null) clearTimeout(t);
    this.celebrationTimer = null; this.chatCallTimer = null; this.missedCallTimer = null; this.offlineCallTimer = null;
    this.platformActionListener?.(); this.platformActionListener = null; this.platformInitialized = false; this.isUserCurrentlyInChat = false;
  }
  private async initPlatformNotifications(): Promise<void> {
    if (this.platformInitialized) return;
    this.platformInitialized = true;
    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.createChannel({ id: 'misa_proactive_channel', name: 'Misa JEE Study Partner', description: 'Spontaneous check-ins, study nudges, and calls from Misa', importance: 5, visibility: 1, vibration: true, sound: 'res_custom_notification' });
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
        const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (action) => { const extra = action.notification.extra; if (extra?.offlineMessage) this.injectMessageIntoChat(extra.offlineMessage, { allowDuringChat: true }); });
        this.platformActionListener = () => void handle.remove();
      } catch (err) { console.warn('[ProactiveAgent] LocalNotifications setup failed:', err); }
    }
    this.checkColdStartOnboarding();
    this.platformIntervals.push(globalThis.setInterval(() => { this.checkAndDispatchDueTriggers(); this.checkScheduledMessages(); }, 20000));
    this.platformIntervals.push(globalThis.setInterval(() => { this.checkInactivityAndFire(); }, 2 * 60 * 1000));
    this.platformIntervals.push(globalThis.setInterval(() => { void this.checkSpontaneousMemoryMessage(); }, 4 * 60 * 1000));
    this.platformIntervals.push(globalThis.setInterval(() => { this.checkMissedInteractionFollowUp(); }, 3 * 60 * 1000));
    this.platformTimeout = globalThis.setTimeout(() => { this.checkAndDispatchDueTriggers(); this.checkInactivityAndFire(); this.checkScheduledMessages(); void this.checkSpontaneousMemoryMessage(); this.checkMissedInteractionFollowUp(); }, 5000);
  }
  private checkAndDispatchDueTriggers(): void {
    // Background scheduled nudges must never interrupt an active user chat session/turn.
    if (!this.prefs.enabled || this.isQuietTime() || isLiveCallActive() || this.userTurnInFlight || this.isUserCurrentlyInChat) return;
    const now = Date.now(); const due = this.pendingTriggers.filter((t) => t.scheduledTime <= now); if (due.length === 0) return;
    this.pendingTriggers = this.pendingTriggers.filter((t) => t.scheduledTime > now); this.saveState();
    const relState = relationshipManager.getState();
    for (const trig of due) {
      if (trig.type === "incoming_call") { this.triggerIncomingCall(trig.callReason || "Scheduled study check-in"); continue; }
      const validation = validateProactiveDelivery({ id: `trig_${trig.id}`, type: "commitment_followup", topic: trig.topic, urgency: 0.7, relevance: 0.85, confidence: 0.9, freshness: 0.9, offlineText: trig.offlineMessage, isInsideActiveSession: this.isUserCurrentlyInChat }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, isInsideActiveSession: this.isUserCurrentlyInChat, recentSentMessages: relState.recentSentMessages, now });
      const msg = validation.sanitizedText || trig.offlineMessage;
      this.injectMessageIntoChat(msg); relationshipManager.recordProactiveSent(trig.topic || "proactive_nudge", msg);
    }
  }
  private checkScheduledMessages(): void {
    // Background scheduled messages wait until the active chat is idle.
    if (!this.prefs.enabled || this.isQuietTime() || isLiveCallActive() || this.userTurnInFlight || this.isUserCurrentlyInChat) return;
    const now = Date.now(); const due = this.scheduledMessages.filter((s) => s.scheduledTime <= now && !s.cancelled); if (due.length === 0) return;
    this.scheduledMessages = this.scheduledMessages.filter((s) => s.scheduledTime > now); this.saveState();
    for (const item of due) {
      if (item.kind === 'call') {
        const fired = this.triggerIncomingCall(item.reason || 'Misa ne schedule kiya tha');
        if (!fired) { const tries = (item.deliveryRetries ?? 0) + 1; if (tries < ProactiveAgentService.MAX_DELIVERY_RETRIES) { this.scheduledMessages.push({ ...item, scheduledTime: now + 5 * 60 * 1000, deliveryRetries: tries }); this.saveState(); } }
      } else if (item.text) {
        const relState = relationshipManager.getState(); const validation = validateProactiveDelivery({ id: `sch_${item.id}`, type: 'commitment_followup', topic: item.topic, urgency: 0.7, relevance: 0.85, confidence: 0.9, freshness: 0.9, offlineText: item.text, isInsideActiveSession: this.isUserCurrentlyInChat }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, isInsideActiveSession: this.isUserCurrentlyInChat, recentSentMessages: relState.recentSentMessages, now });
        if (!validation.valid) { const tries = (item.deliveryRetries ?? 0) + 1; if (tries >= ProactiveAgentService.MAX_DELIVERY_RETRIES) continue; this.scheduledMessages.push({ ...item, scheduledTime: now + 5 * 60 * 1000, deliveryRetries: tries }); this.saveState(); continue; }
        const msg = validation.sanitizedText || item.text; this.injectMessageIntoChat(msg); relationshipManager.recordProactiveSent(item.topic || 'ai_scheduled', msg);
      }
    }
  }
  scheduleMessage(text: string, scheduledTime: number, topic?: string, linkedEntity?: ScheduledProactiveMessage['linkedEntity']): string { const item: ScheduledProactiveMessage = { id: crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, kind: 'message', text, topic, scheduledTime, createdAt: Date.now(), linkedEntity }; this.scheduledMessages.push(item); this.saveState(); return item.id; }
  scheduleCall(reason: string, scheduledTime: number): string { const item: ScheduledProactiveMessage = { id: crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, kind: 'call', reason, scheduledTime, createdAt: Date.now() }; this.scheduledMessages.push(item); this.saveState(); return item.id; }
  cancelScheduledForDoneEntity(type: 'todo' | 'task' | 'memory' | 'keyword', value: string): number {
    if (!value) return 0; const norm = value.trim().toLowerCase(); const before = this.scheduledMessages.length;
    this.scheduledMessages = this.scheduledMessages.map((s) => { if (s.cancelled || s.scheduledTime <= Date.now()) return s; const ent = s.linkedEntity; if (!ent || ent.type !== type) return s; const entNorm = (ent.value || '').trim().toLowerCase(); if (entNorm === '') return s; return entNorm === norm || norm.includes(entNorm) || entNorm.includes(norm) ? { ...s, cancelled: true } : s; });
    if (this.scheduledMessages.length !== before) { this.saveState(); return before - this.scheduledMessages.length; } return 0;
  }
  notifyEntityCompleted(type: 'todo' | 'task' | 'memory' | 'keyword', value: string): void { this.cancelScheduledForDoneEntity(type, value); }
  makeCall(reason: string): boolean { return this.triggerIncomingCall(reason || 'Misa call kar rahi hai', 'user_tool'); }
  cancelScheduledMessage(id: string): boolean { const index = this.scheduledMessages.findIndex((s) => s.id === id && !s.cancelled); if (index < 0) return false; this.scheduledMessages[index] = { ...this.scheduledMessages[index], cancelled: true }; this.saveState(); return true; }
  listScheduledMessages(): ScheduledProactiveMessage[] { const now = Date.now(); return this.scheduledMessages.filter((s) => s.scheduledTime > now && !s.cancelled).sort((a, b) => a.scheduledTime - b.scheduledTime); }
  private async checkSpontaneousMemoryMessage(): Promise<void> {
    if (!this.prefs.enabled || this.isQuietTime() || isLiveCallActive()) return;
    const now = Date.now(); if (now < this.nextSpontaneousAt || this.currentActivityState === 'DEEP_STUDY' || this.currentActivityState === 'SOLVING' || this.isUserCurrentlyInChat) return;
    const relState = relationshipManager.getState(); if (now - this.lastActiveTimestamp < this.prefs.activeGraceMinutes * 60 * 1000 && this.lastActiveTimestamp > 0) return;
    const hasMemorySource = (relState.pendingPromises?.length ?? 0) > 0 || (relState.commitments?.length ?? 0) > 0 || (relState.durableMemories?.length ?? 0) > 0 || !!relState.currentProblemArea || (relState.currentSubject && relState.currentSubject !== 'General');
    if (!hasMemorySource) return;
    for (const expires of Object.values(relState.fatigue?.topicCooldowns ?? {})) if (now < expires) return;
    let sourceLabel = 'jee_prep'; let situation = ''; let offlineMsg = ''; let foundSource = false; const today = new Date().toISOString().slice(0, 10);
    const duePromise = relState.pendingPromises?.find((p: any) => !p.isResumed && p.targetDate && p.targetDate <= today);
    if (duePromise) { foundSource = true; sourceLabel = 'jee_prep'; situation = `Student ne promise kiya tha: "${duePromise.userPromise}" (target: ${duePromise.targetDate}). Wo target date aa gayi hai, isliye ab puchhna natural hai. Warm, chhota, zero-guilt reminder bhejo.`; offlineMsg = `Arey, woh "${duePromise.userPromise}" wali baat — aaj uska waqt tha na? Kaisa raha? 😏`; }
    if (!foundSource && (relState.commitments?.length ?? 0) > 0) { const commitment = relState.commitments[0]; const lastTouch = commitment.updatedAt || commitment.createdAt || 0; const commitmentAgeDays = (now - lastTouch) / (24 * 3600 * 1000); const isActiveCommitment = commitment.state === 'STARTED' || commitment.state === 'PLANNED' || commitment.state === 'RESUMED'; if (commitmentAgeDays >= 1 && commitmentAgeDays <= 7 && isActiveCommitment) { foundSource = true; sourceLabel = commitment.topic || 'jee_prep'; situation = `Student ka active commitment hai: "${commitment.sourceText}" (topic: ${commitment.topic || 'daily study'}), jo ${Math.round(commitmentAgeDays)} din se touch nahi hua. Ek warm check-in bhejo — kya target kaisa chal raha hai, problem ho toh saath karein.`; offlineMsg = `Suno, "${commitment.sourceText}" — ${Math.round(commitmentAgeDays)} din ho gaye. Ab kaisa chal raha hai? Koi fasi baat ho toh batana! 💪`; } }
    if (!foundSource && (relState.durableMemories?.length ?? 0) > 0) { const candidates = relState.durableMemories.filter((m) => m.confidence >= 0.6 && !m.isMastered && m.category !== 'preference').sort((a, b) => (b.confidence - a.confidence) || (b.lastReinforcedAt - a.lastReinforcedAt)); const memory = candidates[0]; if (memory) { foundSource = true; sourceLabel = memory.topic || memory.subject || 'jee_prep'; situation = `Student ki ek baat yaad hai: "${memory.fact}" (category: ${memory.category}). Ye unlinked/not-mastered hai, isliye genuine laga. Ussi se juda ek natural warm chhota message bhejo.`; if (memory.category === 'target') offlineMsg = `Arey, aaj ka revision target yaad aaya — "${memory.fact}" wala target aaj kaisa chal raha hai? 💪`; else if (memory.category === 'habit') offlineMsg = `Yaad aaya, tumne bataya tha "${memory.fact}" — aaj ka count kaise hai?`; else offlineMsg = `Woh "${memory.fact}" wali cheez — ab kaisa lag raha hai?`; } }
    if (!foundSource && relState.currentProblemArea) { foundSource = true; sourceLabel = relState.currentProblemArea; situation = `Student recently "${relState.currentProblemArea}" par kaam kar raha tha. Usi se juda ek chhota natural message bhejo.`; offlineMsg = `Woh "${relState.currentProblemArea}" wala doubt — kuch progress hua na?`; } else if (!foundSource && relState.currentSubject && relState.currentSubject !== 'General') { foundSource = true; sourceLabel = relState.currentSubject; situation = `Student ka current subject "${relState.currentSubject}" hai. Uss subject ke liye ek motivating chhota message bhejo.`; offlineMsg = `${relState.currentSubject} ke targets kaisi chal rahi hai aaj? Ek doubt nikalte hain! 🔥`; }
    if (!foundSource) { this.nextSpontaneousAt = now + ProactiveAgentService.SPONTANEOUS_MIN_GAP_MS; return; }
    this.nextSpontaneousAt = now + ProactiveAgentService.SPONTANEOUS_MIN_GAP_MS;
    const msg = await this.generateDynamicProactiveMessage(situation, sourceLabel).catch(() => offlineMsg); const finalMsg = msg?.trim() || offlineMsg;
    const validation = validateProactiveDelivery({ id: 'spontaneous_memory', type: 'check_in', topic: sourceLabel, urgency: 0.55, relevance: 0.8, confidence: 0.85, freshness: 0.9, offlineText: finalMsg, isInsideActiveSession: this.isUserCurrentlyInChat }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, isInsideActiveSession: this.isUserCurrentlyInChat, recentSentMessages: relState.recentSentMessages, now });
    if (!validation.valid) { this.nextSpontaneousAt = now + ProactiveAgentService.SPONTANEOUS_MIN_GAP_MS; return; }
    const decision = socialDecisionEngine.shouldSpeak({ id: 'spontaneous_memory', type: 'check_in', topic: sourceLabel, urgency: 0.55, relevance: 0.8, confidence: 0.85, freshness: 0.9, offlineText: finalMsg }, relState, this.lastActiveTimestamp, now, this.currentActivityState); if (!decision.allow) { this.nextSpontaneousAt = now + ProactiveAgentService.SPONTANEOUS_MIN_GAP_MS; return; }
    const text = validation.sanitizedText || finalMsg; this.injectMessageIntoChat(text); relationshipManager.recordProactiveSent(sourceLabel, text); this.recordUserActivity(); this.nextSpontaneousAt = now + ProactiveAgentService.SPONTANEOUS_MIN_GAP_MS;
  }
  async generateDynamicProactiveMessage(situation: string, topic?: string): Promise<string> {
    const relState = relationshipManager.getState(); const activeTopic = topic || relState.commitments[0]?.topic || relState.currentProblemArea || relState.currentSubject || 'JEE study'; const recentStruggle = relState.durableMemories.find((m) => m.category === 'struggle')?.fact;
    try {
      if (typeof container !== 'undefined' && container?.llm?.isAvailable()) {
        const systemInstruction = `You are Misa, a warm, caring, real human-like female JEE study partner and best friend.\nStudent Context:\n- Current Target Topic: "${activeTopic}"\n- Recent Struggle/Doubt: ${recentStruggle ? `"${recentStruggle}"` : 'None recorded'}\n- Situation: ${situation}\n\nInstructions:\n- Write exactly 1 short, natural, warm Hinglish message (maximum 1-2 sentences) directly to the student.\n- DO NOT say "As an AI" or "Misa here" or "Main aapki study assistant hoon" or "Kya main aapki madad kar sakti hoon?".\n- Speak like a real close friend on WhatsApp (casual, warm, empathetic, motivational).\n- You can use natural words like "bhai", "yaar", "suno", or light emojis.`;
        const res = await container.llm.complete({ messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: `Send a natural, 1-line study check-in message for situation: ${situation}` }], temperature: 0.85, maxTokens: 80 });
        const reply = res.text?.trim(); if (reply && reply.length > 5 && reply.length < 220) return reply.replace(/^["']|["']$/g, '');
      }
    } catch (err) { console.warn('[ProactiveAgent] Dynamic LLM generation fallback:', err); }
    return pickContextualMessage(topic || 'jee_prep', relState);
  }
  private async checkInactivityAndFire(): Promise<void> {
    if (!this.prefs.enabled || this.isQuietTime() || isLiveCallActive() || this.inactivityCheckInFlight) return; this.inactivityCheckInFlight = true;
    try {
      const now = Date.now(); const effectiveLastActive = Math.max(this.lastUserChatTimestamp || 0, this.lastActiveTimestamp || 0); const inactiveSince = effectiveLastActive > 0 ? now - effectiveLastActive : 0; const activeSince = now - this.lastActiveTimestamp;
      if (activeSince < this.prefs.activeGraceMinutes * 60 * 1000 && effectiveLastActive > 0) return;
      if (this.currentActivityState === 'DEEP_STUDY' || this.currentActivityState === 'SOLVING') return;
      if (this.pendingTriggers.some((t) => t.scheduledTime > now - 30 * 60 * 1000)) return;
      const relState = relationshipManager.getState();
      if (effectiveLastActive > 0 && inactiveSince >= 2.5 * 3600 * 1000 && inactiveSince < 24 * 3600 * 1000) {
        const lastDaytimeNudge = relState.fatigue.topicCooldowns['inactivity_daytime'] || 0;
        if (now >= lastDaytimeNudge) {
          const situation = this.lastUserChatTimestamp === 0 ? 'Student has opened/used the app but has not yet chatted or started their daily study sprint.' : 'Student has been quietly studying or away from study session for ~3 hours during daytime.';
          const msg = await this.generateDynamicProactiveMessage(situation, 'inactivity_daytime');
          const validation = validateProactiveDelivery({ id: 'inactivity_daytime', type: 'check_in', urgency: 0.6, relevance: 0.85, confidence: 0.9, freshness: 0.9, offlineText: msg, isInsideActiveSession: this.isUserCurrentlyInChat }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, isInsideActiveSession: this.isUserCurrentlyInChat, recentSentMessages: relState.recentSentMessages, now });
          if (validation.valid) { this.injectMessageIntoChat(validation.sanitizedText || msg); relationshipManager.recordProactiveSent('inactivity_daytime', msg); this.lastUserChatTimestamp = now; return; }
          return;
        }
      }
      if (effectiveLastActive > 0 && inactiveSince >= 96 * 3600 * 1000) {
        const msg = await this.generateDynamicProactiveMessage('Student has been inactive for 4 days. Send a warm, zero-guilt, fresh start reset message.', 'inactivity_96h');
        const validation = validateProactiveDelivery({ id: 'inactivity_96h', type: 'check_in', urgency: 0.7, relevance: 0.8, confidence: 0.9, freshness: 0.9, offlineText: msg }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, recentSentMessages: relState.recentSentMessages, now });
        if (validation.valid) { this.injectMessageIntoChat(validation.sanitizedText || msg); relationshipManager.recordProactiveSent('inactivity_96h', msg); this.lastUserChatTimestamp = now; } return;
      } else if (effectiveLastActive > 0 && inactiveSince >= 48 * 3600 * 1000) {
        const msg = await this.generateDynamicProactiveMessage('Student has been quiet for 2 days. Send a friendly, low-pressure check-in.', 'inactivity_48h');
        const validation = validateProactiveDelivery({ id: 'inactivity_48h', type: 'check_in', urgency: 0.6, relevance: 0.75, confidence: 0.85, freshness: 0.85, offlineText: msg }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, recentSentMessages: relState.recentSentMessages, now });
        if (validation.valid) { this.injectMessageIntoChat(validation.sanitizedText || msg); relationshipManager.recordProactiveSent('inactivity_48h', msg); this.lastUserChatTimestamp = now; } return;
      } else if (effectiveLastActive > 0 && inactiveSince >= 24 * 3600 * 1000) {
        const msg = await this.generateDynamicProactiveMessage('Student has been away for 24 hours. Encourage starting with 1 small study target today.', 'inactivity_24h');
        const validation = validateProactiveDelivery({ id: 'inactivity_24h', type: 'check_in', urgency: 0.5, relevance: 0.7, confidence: 0.8, freshness: 0.8, offlineText: msg }, relState, { lastActiveTimestamp: this.lastActiveTimestamp, recentSentMessages: relState.recentSentMessages, now });
        if (validation.valid) { this.injectMessageIntoChat(validation.sanitizedText || msg); relationshipManager.recordProactiveSent('inactivity_24h', msg); this.lastUserChatTimestamp = now; } return;
      }
      this.evaluateSpontaneousCall(now, relState);
    } finally { this.inactivityCheckInFlight = false; }
  }
  private evaluateSpontaneousCall(now: number, relState: any): void { if (!this.prefs.callsEnabled || this.prefs.callFrequency === 'request_only' || this.isQuietTime()) return; if (this.currentActivityState === 'DEEP_STUDY' || this.currentActivityState === 'SOLVING' || this.currentActivityState === 'WRITING') return; const minCallInterval = this.prefs.callFrequency === 'rare' ? 4 * 24 * 3600 * 1000 : 2 * 24 * 3600 * 1000; const declinePenaltyMs = (3 + this.consecutiveCallDeclines) * 24 * 3600 * 1000; const sevenDays = 7 * 24 * 3600 * 1000; const effectiveLastActive = Math.max(this.lastUserChatTimestamp || 0, this.lastActiveTimestamp || 0); const callReady = now - this.lastCallTimestamp > minCallInterval && now - this.lastCallDeclinedTimestamp > declinePenaltyMs && effectiveLastActive > 0 && now - effectiveLastActive < sevenDays && relState.fatigue.fatigueScore < 0.4; if (callReady && Math.random() < 0.1) { const commitments = relState.commitments.filter((c: any) => c.state === 'PLANNED'); const reason = commitments.length > 0 ? `${commitments[0].topic} study check-in` : 'Study check-in'; this.triggerIncomingCall(reason); } }
  recordUserActivity(): void { this.lastActiveTimestamp = Date.now(); this.saveState(); }
  recordTyping(): void { const now = Date.now(); this.lastActiveTimestamp = now; this.lastUserChatTimestamp = now; this.isUserCurrentlyInChat = true; if (now - this.lastTypingPersistAt > 20000) { this.lastTypingPersistAt = now; this.saveState(); } }
  setDNDDuration(durationMs: number): void { this.dndUntilTimestamp = Date.now() + durationMs; this.cancelAllPendingTriggers(); this.saveState(); }
  isQuietTime(): boolean { const now = new Date(); if (Date.now() < this.dndUntilTimestamp) return true; try { const [startH, startM] = this.prefs.quietHoursStart.split(':').map(Number); const [endH, endM] = this.prefs.quietHoursEnd.split(':').map(Number); const currentMins = now.getHours() * 60 + now.getMinutes(); const startMins = startH * 60 + startM; const endMins = endH * 60 + endM; if (startMins > endMins) return currentMins >= startMins || currentMins < endMins; return currentMins >= startMins && currentMins < endMins; } catch { return false; } }
  async cancelAllPendingTriggers(): Promise<void> { if (Capacitor.isNativePlatform()) { try { const ids = this.pendingTriggers.map((t) => ({ id: t.id })); if (ids.length > 0) await LocalNotifications.cancel({ notifications: ids }); } catch (e) {} } this.pendingTriggers = []; this.saveState(); }
  async onTaskCompleted(taskId?: string, taskTitle?: string): Promise<void> { this.recordUserActivity(); if (!taskId && !taskTitle) return; const remaining: ProactiveTrigger[] = []; const toCancel: Array<{ id: number }> = []; const lowerTitle = (taskTitle || '').toLowerCase(); for (const trig of this.pendingTriggers) { const matchTask = trig.relatedTaskId && trig.relatedTaskId === taskId; const matchTopic = trig.topic && lowerTitle.includes(trig.topic.toLowerCase()); if (matchTask || matchTopic) toCancel.push({ id: trig.id }); else remaining.push(trig); } if (toCancel.length > 0 && Capacitor.isNativePlatform()) { try { await LocalNotifications.cancel({ notifications: toCancel }); } catch {} } this.pendingTriggers = remaining; this.saveState(); if (taskTitle) { const comm = relationshipManager.findCommitmentByTopic(taskTitle); if (comm) relationshipManager.updateCommitmentState(comm.id, 'COMPLETED'); else relationshipManager.reinforceTopicSuccess(taskTitle); const celebMsg = pickVariedTemplate('celebration', relationshipManager.getState().recentSentMessages); if (this.celebrationTimer !== null) clearTimeout(this.celebrationTimer); this.celebrationTimer = setTimeout(() => { this.celebrationTimer = null; this.injectMessageIntoChat(celebMsg); }, 800); } }
  onChatTurn(userText: string, assistantReply: string, context?: { tasksCount?: number; streak?: number }): void { if (!this.prefs.enabled) return; this.userTurnInFlight = false; this.recordUserActivity(); this.isUserCurrentlyInChat = true; relationshipManager.recordAppEngaged(); this.lastUserChatTimestamp = Date.now(); const lowerUser = userText.toLowerCase(); if (lowerUser.includes('disturb mat') || lowerUser.includes('message mat karna') || lowerUser.includes('call mat karna') || lowerUser.includes('dnd')) { let hours = 2; const match = lowerUser.match(/(\d+)\s*(?:ghante|ghanta|hour|hr)/); if (match) hours = parseInt(match[1], 10) || 2; this.setDNDDuration(hours * 3600 * 1000); return; } if (lowerUser.includes('call karo') || lowerUser.includes('call pe aao') || lowerUser.includes('call lagao') || lowerUser.includes('mujhe call karo') || lowerUser.includes('call me') || lowerUser.includes('phone karo') || lowerUser.includes('call karna') || lowerUser.includes('mujhe call')) { if (Date.now() - this.lastUserToolCallTimestamp < 30000) return; this.chatCallTimer = setTimeout(() => { this.chatCallTimer = null; this.triggerIncomingCall('User ne chat me call karne ko kaha', 'user_tool'); }, 1800); return; } if (lowerUser.includes('kal batata') || lowerUser.includes('kal bataunga') || lowerUser.includes('baad me batata') || lowerUser.includes('baad me bataunga')) relationshipManager.addUserPromise(userText); const hasCommitmentIntent = lowerUser.includes('kal ') || lowerUser.includes('karega') || lowerUser.includes('karunga') || lowerUser.includes('questions lagane') || lowerUser.includes('solve karna'); if (hasCommitmentIntent) { const topicMatch = lowerUser.includes('optics') ? 'Optics' : lowerUser.includes('rotation') ? 'Rotation' : lowerUser.includes('organic') ? 'Organic Chemistry' : lowerUser.includes('thermo') ? 'Thermodynamics' : lowerUser.includes('calculus') ? 'Calculus' : 'JEE Problem Solving'; const subjectMatch: SubjectArea = lowerUser.includes('optics') || lowerUser.includes('rotation') || lowerUser.includes('thermo') ? 'Physics' : lowerUser.includes('organic') ? 'Chemistry' : lowerUser.includes('calculus') ? 'Mathematics' : 'General'; const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); relationshipManager.addCommitment({ sourceText: userText, topic: topicMatch, subject: subjectMatch, targetDate: tomorrow.toISOString().slice(0, 10), state: 'PLANNED' }); } if (lowerUser.includes('nahi samajh') || lowerUser.includes('problem ho rahi') || lowerUser.includes('doubt') || lowerUser.includes('stuck')) { const topicMatch = lowerUser.includes('optics') ? 'Optics' : lowerUser.includes('rotation') ? 'Rotation' : lowerUser.includes('organic') ? 'Organic Chemistry' : 'General Doubt'; relationshipManager.addOrUpdateMemory('struggle', `Struggled with ${topicMatch}: "${userText.slice(0, 80)}"`, topicMatch); } if (lowerUser.includes('thak gaya') || lowerUser.includes('exhausted') || lowerUser.includes('demotivated') || lowerUser.includes('stress')) relationshipManager.update((s) => { s.currentMoodContext = 'burnout'; }); if (this.debounceTimer) clearTimeout(this.debounceTimer); this.debounceTimer = setTimeout(() => { this.sealSessionTrigger(userText, assistantReply, context); }, 4000); if (this.sessionIdleTimer) clearTimeout(this.sessionIdleTimer); const topicForFollowUp = lowerUser.includes('optics') ? 'Optics' : lowerUser.includes('rotat') || lowerUser.includes('torque') ? 'Rotation' : lowerUser.includes('organic') || lowerUser.includes('reaction') ? 'Organic Chemistry' : lowerUser.includes('thermo') ? 'Thermodynamics' : lowerUser.includes('calculus') || lowerUser.includes('integrat') ? 'Calculus' : lowerUser.includes('doubt') || lowerUser.includes('nahi samajh') ? 'the doubt you had' : null; this.lastSessionTopic = topicForFollowUp || this.lastSessionTopic; this.sessionIdleTimer = setTimeout(() => {
      // Transition to idle BEFORE evaluation; this is the intentional session-follow-up exception.
      this.isUserCurrentlyInChat = false;
      this.userTurnInFlight = false;
      this.sessionIdleTimer = null;
      this.sessionFollowUpInFlight = true;
      try {
        this.evaluateSessionFollowUp();
      } finally {
        this.sessionFollowUpInFlight = false;
      }
    }, 5 * 60 * 1000); }
  private async sealSessionTrigger(userText: string, _assistantReply: string, _context?: { tasksCount?: number; streak?: number }): Promise<void> { await this.cancelAllPendingTriggers(); const lower = userText.toLowerCase(); const now = Date.now(); let delayMs = 1.5 * 3600 * 1000; let topic = 'jee_prep'; let urgency = 0.6; let relevance = 0.8; let confidence = 0.85; if (lower.includes('optics') || lower.includes('ray diagram') || lower.includes('mirror') || lower.includes('lens')) { topic = 'optics'; delayMs = 1.5 * 3600 * 1000; urgency = 0.8; relevance = 0.95; } else if (lower.includes('rotat') || lower.includes('torque') || lower.includes('moment of inertia')) { topic = 'rotation'; delayMs = 3.5 * 3600 * 1000; urgency = 0.8; relevance = 0.95; } else if (lower.includes('organic') || lower.includes('reaction') || lower.includes('mechanism')) { topic = 'organic'; delayMs = 2 * 3600 * 1000; urgency = 0.75; relevance = 0.9; } else if (lower.includes('thermo') || lower.includes('entropy') || lower.includes('enthalpy')) { topic = 'thermodynamics'; delayMs = 3.5 * 3600 * 1000; urgency = 0.75; relevance = 0.9; } else if (lower.includes('calculus') || lower.includes('integration') || lower.includes('differential')) { topic = 'calculus'; delayMs = 3.5 * 3600 * 1000; urgency = 0.8; relevance = 0.95; } else if (lower.includes('kal') || lower.includes('tomorrow') || lower.includes('subah')) { topic = 'morning_plan'; const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 30, 0, 0); delayMs = Math.max(2 * 3600 * 1000, tomorrow.getTime() - now); urgency = 0.85; relevance = 0.9; } else if (lower.includes('thak') || lower.includes('tired') || lower.includes('demotivat') || lower.includes('stress')) { topic = 'rest_burnout'; delayMs = 45 * 60 * 1000; urgency = 0.65; relevance = 0.85; } const relState = relationshipManager.getState(); const offlineMessage = pickContextualMessage(topic, relState); const scheduledTime = now + delayMs; const candidate: ProactiveCandidate = { id: `cand_${now}`, type: 'commitment_followup', topic, urgency, relevance, confidence, freshness: 0.9, offlineText: offlineMessage }; const decision = socialDecisionEngine.shouldSpeak(candidate, relState, this.lastActiveTimestamp, scheduledTime, this.currentActivityState); if (!decision.allow) return; this.pendingTriggers = this.pendingTriggers.filter((t) => t.topic !== topic); const triggerId = Math.floor(Math.random() * 100000) + 1000; const trigger: ProactiveTrigger = { id: triggerId, idempotencyKey: `${topic}:reminder:${new Date(scheduledTime).toISOString().slice(0, 10)}`, type: 'chat_nudge', scheduledTime, topic, offlineMessage }; this.pendingTriggers.push(trigger); this.saveState(); if (Capacitor.isNativePlatform()) { try { await LocalNotifications.schedule({ notifications: [{ id: triggerId, title: 'Misa', body: offlineMessage, largeBody: offlineMessage, schedule: { at: new Date(scheduledTime), allowWhileIdle: true }, channelId: 'misa_proactive_channel', extra: { offlineMessage, topic } }] }); } catch (err) { console.warn('[ProactiveAgent] Schedule notification error:', err); } } }
  evaluateSessionFollowUp(overrideNow?: number): void { if (this.isQuietTime() || this.userTurnInFlight) return; const now = overrideNow ?? Date.now(); if (now - this.lastUserChatTimestamp < 4.5 * 60 * 1000 && !overrideNow) return; const rel = relationshipManager.getState(); const topic = this.lastSessionTopic || rel.commitments[0]?.topic || rel.currentSubject || null; const followUpMessages = topic ? [`Ek kaam aur batao — ${topic} ka jo section chal raha tha, koi step clear nahi tha kya? 😊`, `Hey, ${topic} wala part kaisa raha? Kuch aur sambhalna ho toh batao! 🎯`, `Suno, ${topic} me koi formula ya concept dobara dekhna ho toh batao, saath me kar lete hain 💪`] : ['Koi aur question chal raha hai? Batao, saath me solve karte hain! 😊', 'Hey, padhai kaisi chal rahi hai? Koi concept fasa hua ho toh batao! 🎯', 'Suno, agar koi doubt hai toh abhi puch lo — main available hoon! 💪']; const sentMsgs = rel.recentSentMessages; const available = followUpMessages.filter((m) => !sentMsgs.includes(m)); const msg = available[Math.floor(Math.random() * available.length)] || followUpMessages[0]; const insideSession = this.isUserCurrentlyInChat || this.sessionFollowUpInFlight; const candidate: ProactiveCandidate = { id: `session_followup_${now}`, type: 'session_followup', topic: topic || undefined, urgency: 0.7, relevance: 0.9, confidence: 0.85, freshness: 0.95, offlineText: msg, isInsideActiveSession: insideSession }; const validation = validateProactiveDelivery(candidate, rel, { lastActiveTimestamp: this.lastActiveTimestamp, isInsideActiveSession: insideSession, recentSentMessages: rel.recentSentMessages, now }); if (!validation.valid) return; const decision = socialDecisionEngine.shouldSpeak(candidate, rel, this.lastActiveTimestamp, now, this.currentActivityState); if (decision.allow) { this.injectMessageIntoChat(validation.sanitizedText || msg, { suppressNotification: this.sessionFollowUpInFlight }); relationshipManager.recordProactiveSent('session_followup', msg); } }
  private async checkColdStartOnboarding(): Promise<void> { if (this.coldStartDone) return; if (this.pendingTriggers.some((t) => t.id === 9901 || t.id === 9902)) return; const now = Date.now(); const day1Time = new Date(); day1Time.setHours(18, 30, 0, 0); if (day1Time.getTime() < now) day1Time.setDate(day1Time.getDate() + 1); const revTime = new Date(); revTime.setHours(20, 0, 0, 0); if (revTime.getTime() < now) revTime.setDate(revTime.getDate() + 1); const trigger: ProactiveTrigger = { id: 9901, type: 'cold_start', scheduledTime: day1Time.getTime(), offlineMessage: 'Hey! Dekha tumne LevelUp install kiya hai par abhi tak baat nahi ki. JEE prep me kya target chal raha hai — milke plan banayein?' }; const revisionTrigger: ProactiveTrigger = { id: 9902, type: 'cold_start', scheduledTime: revTime.getTime(), topic: 'jee_prep', offlineMessage: 'Hey! Aaj ka revision target kaisa progress kar raha hai? Batana agar koi problem fasa ho — saath me crack karte hain! 💪' }; this.pendingTriggers.push(trigger, revisionTrigger); this.coldStartDone = true; this.saveState(); if (Capacitor.isNativePlatform()) { try { await LocalNotifications.schedule({ notifications: [{ id: 9901, title: 'Misa', body: trigger.offlineMessage, largeBody: trigger.offlineMessage, schedule: { at: day1Time, allowWhileIdle: true }, channelId: 'misa_proactive_channel', extra: { offlineMessage: trigger.offlineMessage } }, { id: 9902, title: 'Misa', body: revisionTrigger.offlineMessage, largeBody: revisionTrigger.offlineMessage, schedule: { at: revTime, allowWhileIdle: true }, channelId: 'misa_proactive_channel', extra: { offlineMessage: revisionTrigger.offlineMessage } }] }); } catch {} } }
  triggerIncomingCall(reason = 'Study check-in', origin: LiveCallOrigin = 'auto'): boolean { const userRequested = origin === 'user_tool'; if (!this.prefs.callsEnabled && !userRequested) return false; if (this.isQuietTime() && !userRequested) return false; if (isLiveCallActive()) return false; const now = Date.now(); const minCallInterval = this.prefs.callFrequency === 'rare' ? 4 * 24 * 3600 * 1000 : 2 * 24 * 3600 * 1000; const declinePenaltyMs = (3 + this.consecutiveCallDeclines) * 24 * 3600 * 1000; if (now - this.lastCallDeclinedTimestamp < declinePenaltyMs && !userRequested) return false; if (now - this.lastCallTimestamp < minCallInterval && !userRequested) return false; this.lastCallTimestamp = now; this.saveState(); if (userRequested && this.chatCallTimer !== null) { clearTimeout(this.chatCallTimer); this.chatCallTimer = null; } if (userRequested) this.lastUserToolCallTimestamp = now; const callEvent: IncomingCallEvent = { callId: `call_${now}`, reason, callerName: 'Misa', origin }; for (const listener of this.incomingCallListeners) listener(callEvent); return true; }
  onCallAccepted(_callId: string): void { this.lastActiveTimestamp = Date.now(); this.consecutiveCallDeclines = 0; this.clearMissedCallFollowUps(); this.saveState(); }
  onCallDeclined(_callId: string): void { this.lastCallDeclinedTimestamp = Date.now(); this.consecutiveCallDeclines += 1; this.recordMissedInteraction('call', 'Student ne call decline kiya'); this.saveState(); this.injectCallStatusEvent('declined'); }
  onCallMissed(_callId: string): void { this.recordMissedInteraction('call', 'Student ne call miss kiya'); this.saveState(); this.injectCallStatusEvent('missed'); if (this.missedCallTimer !== null) clearTimeout(this.missedCallTimer); this.missedCallTimer = setTimeout(() => { this.missedCallTimer = null; this.injectMessageIntoChat('Hii, suno? Padh rahe the kya? Free hoke text karna!'); }, 90 * 1000); }
  onOfflineCallAttempt(_callId: string, reason = 'Scheduled study check-in'): void { this.recordMissedInteraction('call', `Offline tha — ${reason} ke liye call nahi ho sakti thi`); this.saveState(); this.injectCallStatusEvent('offline_attempt'); if (this.offlineCallTimer !== null) clearTimeout(this.offlineCallTimer); this.offlineCallTimer = setTimeout(() => { this.offlineCallTimer = null; this.injectMessageIntoChat(`Hii, ${reason} ke liye call plan ki thi par network unreachable tha. Jab online aao toh batana! 📶`); }, 1000); }
  recordMessageLateReply(lateByMs: number): void { if (lateByMs < 30 * 60 * 1000) return; this.recordMissedInteraction('message', `Student ne ${Math.round(lateByMs / 3600000 * 10) / 10} ghante baad message ka reply kiya`); }
  private recordMissedInteraction(kind: 'call' | 'message', detail: string): void { const now = Date.now(); this.missedInteractions.push({ kind, at: now, detail, followedUpAt: null }); this.missedInteractions = this.missedInteractions.filter((m) => now - m.at < ProactiveAgentService.MISSED_FOLLOWUP_MAX_AGE_MS); this.saveState(); }
  private clearMissedCallFollowUps(): void { const before = this.missedInteractions.length; this.missedInteractions = this.missedInteractions.filter((m) => m.kind !== 'call'); if (this.missedInteractions.length !== before) this.saveState(); }
  private checkMissedInteractionFollowUp(): void { if (!this.prefs.enabled || this.isQuietTime() || isLiveCallActive() || this.userTurnInFlight || this.isUserCurrentlyInChat) return; const now = Date.now(); const pending = this.missedInteractions.find((m) => m.followedUpAt === null); if (!pending) return; if (now - pending.at < ProactiveAgentService.MISSED_FOLLOWUP_GRACE_MS) return; const activeRecently = this.lastActiveTimestamp > 0 && now - this.lastActiveTimestamp < 2 * 60 * 60 * 1000; if (!activeRecently) return; let followUp = ''; const hoursLate = Math.round((now - pending.at) / 3600000); if (pending.kind === 'call') followUp = hoursLate <= 24 ? `Arey, abhi aaye ho? Mera call miss ho gaya tha — sab theek hai na? 😄` : `Kal mera call miss ho gaya tha, tab busy the? Theek ho na? 😊`; else followUp = `Hmm, tumne ek lambe time ke baad message kiya (${pending.detail}) — sab theek hai? Lag raha tha mujhse ignore kar rahe the 😅`; this.injectMessageIntoChat(followUp); pending.followedUpAt = now; this.saveState(); }
  injectMessageIntoChat(text: string, options?: { allowDuringChat?: boolean; suppressNotification?: boolean }): void {
    if (isLiveCallActive()) return;
    // Background proactive delivery must never race the user's active LLM turn.
    // Notification-tap delivery is explicitly user-initiated and may opt in.
    if (this.userTurnInFlight && !options?.allowDuringChat) return; const now = Date.now(); const lastInjectedAt = this.recentInjected.get(text); if (lastInjectedAt !== undefined && now - lastInjectedAt < ProactiveAgentService.INJECT_DEDUPE_WINDOW_MS) return; this.recentInjected.set(text, now); if (this.recentInjected.size > 50) for (const [key, at] of this.recentInjected) if (now - at > 60 * 60 * 1000) this.recentInjected.delete(key); const msgId = `msg-${now}-${Math.random().toString(36).slice(2, 6)}`; const payload: MessageInjectionPayload = { role: 'assistant', text, isProactive: true, msgId }; let delivered = false; for (const listener of this.messageInjectionListeners) { try { if (listener(payload) !== false) delivered = true; } catch {} } if (!delivered) { try { const activeId = container?.chat?.getActiveSessionId?.() || container?.chat?.listSessions?.()?.[0]?.id; if (activeId) container.chat.appendMessage(activeId, { id: msgId, role: 'assistant', content: text, createdAt: new Date(now).toISOString(), isProactive: true }); } catch {} } if (!delivered && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('levelup:proactive-message', { detail: { text, isProactive: true, msgId } })); if (Capacitor.isNativePlatform() && !options?.suppressNotification && (!this.isUserCurrentlyInChat || !isAppActive())) void LocalNotifications.schedule({ notifications: [{ id: (now % 2147483647) + 1, title: 'Misa', body: text, largeBody: text, schedule: { at: new Date(now + 100), allowWhileIdle: true }, channelId: 'misa_proactive_channel', extra: { offlineMessage: text } }] }).catch(() => undefined); }
  private injectCallStatusEvent(callStatus: CallStatusType): void { let displayText = '📞 Call Event'; if (callStatus === 'missed') displayText = '📞 Missed Call'; else if (callStatus === 'declined') displayText = '📞 Declined Call'; else if (callStatus === 'offline_attempt') displayText = '📶 Offline Call Attempt'; for (const listener of this.messageInjectionListeners) listener({ role: 'assistant', text: displayText, isCallEvent: true, callStatus }); }
  onIncomingCall(listener: IncomingCallListener): () => void { this.incomingCallListeners.add(listener); return () => this.incomingCallListeners.delete(listener); }
  onMessageInjection(listener: MessageInjectionListener): () => void { this.messageInjectionListeners.add(listener); return () => this.messageInjectionListeners.delete(listener); }
  resetForTesting(): void { this.userTurnInFlight = false; this.sessionFollowUpInFlight = false; this.prefs = { ...DEFAULT_PROACTIVE_PREFS }; this.lastActiveTimestamp = Date.now(); this.lastUserChatTimestamp = 0; this.lastCallTimestamp = 0; this.lastCallDeclinedTimestamp = 0; this.consecutiveCallDeclines = 0; this.dndUntilTimestamp = 0; this.pendingTriggers = []; this.lastSessionTopic = null; this.isUserCurrentlyInChat = false; this.currentActivityState = 'IDLE'; relationshipManager.update((s) => { s.boundaries.quietHoursStart = '03:00'; s.boundaries.quietHoursEnd = '06:00'; }); this.saveState(); }
  resetLocal(): void { this.userTurnInFlight = false; this.sessionFollowUpInFlight = false; this.prefs = { ...DEFAULT_PROACTIVE_PREFS }; this.lastActiveTimestamp = Date.now(); this.lastUserChatTimestamp = 0; this.lastCallTimestamp = 0; this.lastCallDeclinedTimestamp = 0; this.lastUserToolCallTimestamp = 0; this.consecutiveCallDeclines = 0; this.dndUntilTimestamp = 0; this.coldStartDone = false; this.pendingTriggers = []; this.scheduledMessages = []; this.missedInteractions = []; this.saveState(); }
}

export const proactiveAgentService = new ProactiveAgentService();
