/**
 * Misa Central Social Decision Engine ("Kya mujhe abhi bolna chahiye?")
 *
 * Evaluates candidate proactive actions against social boundaries, active grace
 * periods, DND windows, granular topic cooldowns, and unified communication pressure
 * before calculating importance scores and selecting the single highest-value action.
 */

import type { RelationshipState, SubjectArea } from './relationship-state';
import type { UserActivityState } from '../../core/domain/activity-signal';

export interface ProactiveCandidate {
  id: string;
  type:
    | 'commitment_followup'
    | 'overdue_topic'
    | 'milestone'
    | 'check_in'
    | 'struggle_reinforce'
    | 'live_call'
    | 'cold_start'
    | 'session_followup';
  intent?: 'reminder' | 'doubt_followup' | 'urgent_check' | 'recap' | 'general';
  topic?: string;
  subject?: SubjectArea;
  urgency: number; // 0.0 to 1.0
  relevance: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  freshness: number; // 0.0 to 1.0
  userPreference?: number; // 0.0 to 1.0 (default 1.0)
  offlineText: string;
  isCall?: boolean;
  isInsideActiveSession?: boolean;
}

export type MessageStrength =
  | 'light'
  | 'concerned'
  | 'accountability'
  | 'fresh_start'
  | 'celebration'
  | 'frustrated_reassurance';

export interface SevenQuestionsEvaluation {
  q1_whatIsUserDoing: string;
  q2_isUserBusyOrFocused: boolean;
  q3_didSpeakRecently: boolean;
  q4_didUserIgnoreRecently: boolean;
  q5_hasGenuinelyUsefulReason: boolean;
  q6_isNaturalTime: boolean;
  q7_action: 'SAY_NOTHING' | 'SEND_MESSAGE' | 'START_CALL';
  strength: MessageStrength;
  verdictReason: string;
}

export interface DecisionResult {
  allow: boolean;
  reason: string;
  priorityScore: number;
  evaluation?: SevenQuestionsEvaluation;
}

export class SocialDecisionEngine {
  /**
   * Misa's 7 Internal Questions Check (Golden Human Rule)
   * 1. User abhi kya kar raha hai?
   * 2. Kya user busy/focused hai?
   * 3. Maine recently message/call kiya tha?
   * 4. User ne mujhe recently ignore/decline kiya?
   * 5. Kya mere paas genuinely useful reason hai?
   * 6. Kya abhi iska natural time hai?
   * 7. Message better hai ya call?
   */
  evaluateSevenQuestions(
    candidate: ProactiveCandidate,
    relationship: RelationshipState,
    lastActiveTimestamp: number,
    now: number = Date.now(),
    userActivityState: UserActivityState = 'IDLE'
  ): SevenQuestionsEvaluation {
    const isQuiet = this.isWithinQuietHours(
      relationship.boundaries.quietHoursStart,
      relationship.boundaries.quietHoursEnd,
      now
    );
    const isDND = now < relationship.boundaries.dndUntilTimestamp;
    const graceMs = (relationship.boundaries.activeGraceMinutes || 30) * 60 * 1000;
    const isBusyOrFocused = (now - lastActiveTimestamp < graceMs && !candidate.isInsideActiveSession) ||
      userActivityState === 'DEEP_STUDY' ||
      userActivityState === 'SOLVING' ||
      userActivityState === 'WRITING';

    const didSpeakRecently = now - relationship.lastInteractionTimestamp < 45 * 60 * 1000;
    const didUserIgnoreRecently = relationship.fatigue.consecutiveDismissals >= 2;
    const hasGenuinelyUsefulReason = candidate.urgency >= 0.5 || !!candidate.topic;
    const isNaturalTime = !isQuiet && !isDND;

    // Determine strength
    let strength: MessageStrength = 'light';
    const inactivityHours = (now - lastActiveTimestamp) / (3600 * 1000);
    if (inactivityHours >= 96) strength = 'fresh_start';
    else if (inactivityHours >= 48) strength = 'concerned';
    else if (candidate.type === 'commitment_followup') strength = 'accountability';
    else if (candidate.type === 'milestone') strength = 'celebration';

    if (isDND || isQuiet || isBusyOrFocused || !hasGenuinelyUsefulReason) {
      return {
        q1_whatIsUserDoing: isBusyOrFocused ? 'Active / focused solving' : isQuiet ? 'Sleeping / Quiet Hours' : 'Idle',
        q2_isUserBusyOrFocused: isBusyOrFocused,
        q3_didSpeakRecently: didSpeakRecently,
        q4_didUserIgnoreRecently: didUserIgnoreRecently,
        q5_hasGenuinelyUsefulReason: hasGenuinelyUsefulReason,
        q6_isNaturalTime: isNaturalTime,
        q7_action: 'SAY_NOTHING',
        strength,
        verdictReason: isDND ? 'DND Shield' : isQuiet ? 'Quiet Hours' : isBusyOrFocused ? 'Active focus / grace period' : 'No useful reason',
      };
    }

    if (candidate.type === 'live_call' || candidate.isCall) {
      return {
        q1_whatIsUserDoing: 'Idle student ready for voice check-in',
        q2_isUserBusyOrFocused: false,
        q3_didSpeakRecently: didSpeakRecently,
        q4_didUserIgnoreRecently: didUserIgnoreRecently,
        q5_hasGenuinelyUsefulReason: true,
        q6_isNaturalTime: true,
        q7_action: didUserIgnoreRecently ? 'SEND_MESSAGE' : 'START_CALL',
        strength: 'accountability',
        verdictReason: 'Call candidate approved by 7-question filter',
      };
    }

    return {
      q1_whatIsUserDoing: 'Away from app / break',
      q2_isUserBusyOrFocused: false,
      q3_didSpeakRecently: didSpeakRecently,
      q4_didUserIgnoreRecently: didUserIgnoreRecently,
      q5_hasGenuinelyUsefulReason: true,
      q6_isNaturalTime: true,
      q7_action: 'SEND_MESSAGE',
      strength,
      verdictReason: 'Sensible moment for gentle check-in',
    };
  }

  /** Natural Timing Window (±10-20 min jitter so Misa doesn't feel like a rigid alarm clock) */
  getNaturalTimingWindow(baseTimeMs: number): number {
    const jitterMinutes = Math.floor(Math.random() * 21) - 10; // -10 to +10 min
    return baseTimeMs + jitterMinutes * 60 * 1000;
  }

  /**
   * Evaluates if Misa should speak right now for a candidate action.
   */
  shouldSpeak(
    candidate: ProactiveCandidate,
    relationship: RelationshipState,
    lastActiveTimestamp: number,
    now: number = Date.now(),
    userActivityState: UserActivityState = 'IDLE'
  ): DecisionResult {
    // 1. DND Shield check (always first — explicit user request)
    if (now < relationship.boundaries.dndUntilTimestamp) {
      return { allow: false, reason: 'DND Shield active', priorityScore: 0 };
    }

    // 2. In-Session vs Global Active Grace Period:
    // If the candidate is an in-session follow-up within the active chat, allow it.
    // Otherwise, global background notifications are strictly suppressed during the 30-min grace period.
    const graceMs = (relationship.boundaries.activeGraceMinutes || 30) * 60 * 1000;
    if (now - lastActiveTimestamp < graceMs && !candidate.isInsideActiveSession) {
      return { allow: false, reason: 'User was active in app recently (within grace period)', priorityScore: 0 };
    }

    // 3. User is actively in DEEP_STUDY or SOLVING (suppress spontaneous interruptions)
    if ((userActivityState === 'DEEP_STUDY' || userActivityState === 'SOLVING' || userActivityState === 'WRITING') && !candidate.isInsideActiveSession) {
      return { allow: false, reason: `User is in ${userActivityState} mode (focus protected)`, priorityScore: 0 };
    }

    // 4. Granular Topic Cooldown
    // Instead of blocking every event with the same topic, check granular key ${topic}:${intent}:${type}
    if (candidate.topic) {
      const granularKey = `${candidate.topic.toLowerCase()}:${candidate.intent || 'general'}:${candidate.type}`;
      const generalKey = candidate.topic.toLowerCase();

      const granularCooldown = relationship.fatigue.topicCooldowns[granularKey] || 0;
      const generalCooldown = relationship.fatigue.topicCooldowns[generalKey] || 0;

      // Urgent actions (urgency >= 0.85) can bypass general reminders if granular intent is different
      const isUrgent = candidate.urgency >= 0.85;
      if (now < granularCooldown) {
        return { allow: false, reason: `Topic '${candidate.topic}' specific intent is on cooldown`, priorityScore: 0 };
      }
      if (now < generalCooldown && !isUrgent) {
        return { allow: false, reason: `Topic '${candidate.topic}' is on cooldown`, priorityScore: 0 };
      }
    }

    // 5. Quiet Hours check
    if (this.isWithinQuietHours(relationship.boundaries.quietHoursStart, relationship.boundaries.quietHoursEnd, now)) {
      return { allow: false, reason: 'Quiet Hours active (Night time)', priorityScore: 0 };
    }

    // 6. Daily Proactive Budget (max 3 per day for non-call and non-in-session actions)
    const today = new Date(now).toISOString().slice(0, 10);
    const todayCount = relationship.fatigue.proactiveDate === today ? relationship.fatigue.todayProactiveCount : 0;
    if (todayCount >= 3 && candidate.type !== 'live_call' && !candidate.isInsideActiveSession) {
      return { allow: false, reason: 'Daily proactive budget reached (max 3/day)', priorityScore: 0 };
    }

    // 7. Notification Fatigue Threshold (back off if 3+ consecutive dismissals)
    if (relationship.fatigue.consecutiveDismissals >= 3 && candidate.type !== 'live_call' && !candidate.isInsideActiveSession) {
      if (candidate.urgency < 0.85) {
        return { allow: false, reason: 'User recently dismissed multiple notifications (Fatigue penalty)', priorityScore: 0 };
      }
    }

    // Passed all social guard checks — calculate priority
    const score = this.calculatePriority(candidate, relationship);
    return { allow: true, reason: 'Approved by Social Decision Engine', priorityScore: score };
  }

  /**
   * Priority = Urgency × Relevance × Confidence × Freshness × UserPreference × (1 - 0.4 × FatigueScore)
   */
  calculatePriority(candidate: ProactiveCandidate, relationship: RelationshipState): number {
    const u = Math.max(0.1, Math.min(1.0, candidate.urgency));
    const r = Math.max(0.1, Math.min(1.0, candidate.relevance));
    const c = Math.max(0.1, Math.min(1.0, candidate.confidence));
    const f = Math.max(0.1, Math.min(1.0, candidate.freshness));
    const p = Math.max(0.1, Math.min(1.0, candidate.userPreference ?? 1.0));

    const fatiguePenalty = 1.0 - 0.4 * (relationship.fatigue.fatigueScore || 0);
    const rawScore = u * r * c * f * p * fatiguePenalty;

    // Type Boost hierarchy
    let typeBoost = 1.0;
    if (candidate.type === 'commitment_followup') typeBoost = 1.4;
    else if (candidate.type === 'struggle_reinforce') typeBoost = 1.25;
    else if (candidate.type === 'live_call') typeBoost = 1.35;
    else if (candidate.type === 'session_followup') typeBoost = 1.2;
    else if (candidate.type === 'milestone') typeBoost = 1.15;

    return Math.round(rawScore * typeBoost * 1000) / 1000;
  }

  /**
   * Evaluates a pool of candidate triggers and picks strictly the BEST-1 action.
   */
  selectBestCandidate(
    candidates: ProactiveCandidate[],
    relationship: RelationshipState,
    lastActiveTimestamp: number,
    now: number = Date.now(),
    userActivityState: UserActivityState = 'IDLE'
  ): { candidate: ProactiveCandidate; score: number } | null {
    if (!candidates || candidates.length === 0) return null;

    const approved: Array<{ candidate: ProactiveCandidate; score: number }> = [];

    for (const candidate of candidates) {
      const decision = this.shouldSpeak(candidate, relationship, lastActiveTimestamp, now, userActivityState);
      if (decision.allow) {
        approved.push({ candidate, score: decision.priorityScore });
      }
    }

    if (approved.length === 0) return null;

    approved.sort((a, b) => b.score - a.score);
    return approved[0];
  }

  private isWithinQuietHours(start: string, end: string, now: number): boolean {
    const d = new Date(now);
    const currentMins = d.getHours() * 60 + d.getMinutes();

    const [sh, sm] = (start || '22:30').split(':').map(Number);
    const [eh, em] = (end || '07:30').split(':').map(Number);

    const startMins = (sh || 22) * 60 + (sm || 30);
    const endMins = (eh || 7) * 60 + (em || 30);

    if (startMins > endMins) {
      // Overnight (e.g. 22:30 -> 07:30)
      return currentMins >= startMins || currentMins < endMins;
    }
    return currentMins >= startMins && currentMins < endMins;
  }
}

export const socialDecisionEngine = new SocialDecisionEngine();
