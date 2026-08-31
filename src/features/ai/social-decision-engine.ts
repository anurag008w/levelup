/**
 * Misa Central Social Decision Engine ("Kya mujhe abhi bolna chahiye?")
 *
 * Evaluates candidate proactive actions against social boundaries, active grace
 * periods, DND windows, topic cooldowns, and notification fatigue before
 * calculating importance scores and selecting the single highest-value action.
 */

import type { RelationshipState, SubjectArea } from './relationship-state';

export interface ProactiveCandidate {
  id: string;
  type:
    | 'commitment_followup'
    | 'overdue_topic'
    | 'milestone'
    | 'check_in'
    | 'struggle_reinforce'
    | 'live_call'
    | 'cold_start';
  topic?: string;
  subject?: SubjectArea;
  urgency: number; // 0.0 to 1.0
  relevance: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  freshness: number; // 0.0 to 1.0
  userPreference?: number; // 0.0 to 1.0 (default 1.0)
  offlineText: string;
  isCall?: boolean;
}

export interface DecisionResult {
  allow: boolean;
  reason: string;
  priorityScore: number;
}

export class SocialDecisionEngine {
  /**
   * Evaluates if Misa should speak right now for a candidate action.
   */
  shouldSpeak(
    candidate: ProactiveCandidate,
    relationship: RelationshipState,
    lastActiveTimestamp: number,
    now: number = Date.now()
  ): DecisionResult {
    // 1. DND Shield check
    if (now < relationship.boundaries.dndUntilTimestamp) {
      return { allow: false, reason: 'DND Shield active', priorityScore: 0 };
    }

    // 2. Quiet Hours check
    if (this.isWithinQuietHours(relationship.boundaries.quietHoursStart, relationship.boundaries.quietHoursEnd, now)) {
      return { allow: false, reason: 'Quiet Hours active (Night time)', priorityScore: 0 };
    }

    // 3. Active In-App Grace Period (Anti-Distraction Shield)
    const graceMs = (relationship.boundaries.activeGraceMinutes || 30) * 60 * 1000;
    if (now - lastActiveTimestamp < graceMs) {
      return { allow: false, reason: 'User was active in app recently (within 30m grace)', priorityScore: 0 };
    }

    // 4. Daily Proactive Budget (max 2 per day)
    const today = new Date(now).toISOString().slice(0, 10);
    const todayCount = relationship.fatigue.proactiveDate === today ? relationship.fatigue.todayProactiveCount : 0;
    if (todayCount >= 2 && candidate.type !== 'live_call') {
      return { allow: false, reason: 'Daily proactive budget reached (max 2/day)', priorityScore: 0 };
    }

    // 5. Same-Topic Cooldown (no repeating topic within 48h)
    if (candidate.topic) {
      const cooldownEnd = relationship.fatigue.topicCooldowns[candidate.topic.toLowerCase()] || 0;
      if (now < cooldownEnd) {
        return { allow: false, reason: `Topic '${candidate.topic}' is on cooldown`, priorityScore: 0 };
      }
    }

    // 6. Notification Fatigue Threshold (back off if 3+ consecutive dismissals)
    if (relationship.fatigue.consecutiveDismissals >= 3 && candidate.type !== 'live_call') {
      // Allow only high-urgency commitment followups
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
    now: number = Date.now()
  ): { candidate: ProactiveCandidate; score: number } | null {
    if (!candidates || candidates.length === 0) return null;

    const approved: Array<{ candidate: ProactiveCandidate; score: number }> = [];

    for (const candidate of candidates) {
      const decision = this.shouldSpeak(candidate, relationship, lastActiveTimestamp, now);
      if (decision.allow) {
        approved.push({ candidate, score: decision.priorityScore });
      }
    }

    if (approved.length === 0) return null;

    // Sort descending by priority score
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
