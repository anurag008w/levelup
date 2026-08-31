import { describe, it, expect, beforeEach } from 'vitest';
import { socialDecisionEngine, type ProactiveCandidate } from '../social-decision-engine';
import { DEFAULT_RELATIONSHIP_STATE, type RelationshipState } from '../relationship-state';

describe('SocialDecisionEngine', () => {
  let mockState: RelationshipState;

  beforeEach(() => {
    mockState = {
      ...DEFAULT_RELATIONSHIP_STATE,
      boundaries: {
        dndUntilTimestamp: 0,
        quietHoursStart: '22:30',
        quietHoursEnd: '07:30',
        activeGraceMinutes: 30,
      },
      fatigue: {
        consecutiveDismissals: 0,
        fatigueScore: 0,
        lastDismissalTimestamp: 0,
        todayProactiveCount: 0,
        proactiveDate: '2026-09-01',
        topicCooldowns: {},
      },
    };
  });

  it('blocks proactive action when DND shield is active', () => {
    mockState.boundaries.dndUntilTimestamp = Date.now() + 3600000;
    const candidate: ProactiveCandidate = {
      id: 'c1',
      type: 'commitment_followup',
      topic: 'Optics',
      urgency: 0.9,
      relevance: 0.9,
      confidence: 0.9,
      freshness: 0.9,
      offlineText: 'Test',
    };

    const decision = socialDecisionEngine.shouldSpeak(candidate, mockState, Date.now() - 40 * 60 * 1000);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain('DND');
  });

  it('blocks proactive action during active 30-min in-app grace period', () => {
    const lastActive = Date.now() - 10 * 60 * 1000; // 10m ago (within 30m)
    const candidate: ProactiveCandidate = {
      id: 'c1',
      type: 'commitment_followup',
      topic: 'Optics',
      urgency: 0.8,
      relevance: 0.9,
      confidence: 0.9,
      freshness: 0.9,
      offlineText: 'Test',
    };

    const decision = socialDecisionEngine.shouldSpeak(candidate, mockState, lastActive);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain('grace');
  });

  it('blocks proactive action when same topic is in cooldown', () => {
    mockState.fatigue.topicCooldowns['optics'] = Date.now() + 24 * 3600000;
    const candidate: ProactiveCandidate = {
      id: 'c1',
      type: 'commitment_followup',
      topic: 'Optics',
      urgency: 0.8,
      relevance: 0.9,
      confidence: 0.9,
      freshness: 0.9,
      offlineText: 'Test',
    };

    const decision = socialDecisionEngine.shouldSpeak(candidate, mockState, Date.now() - 45 * 60 * 1000);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain('cooldown');
  });

  it('evaluates priority score based on urgency, relevance, confidence and freshness', () => {
    const candidateHigh: ProactiveCandidate = {
      id: 'c_high',
      type: 'commitment_followup',
      topic: 'Optics',
      urgency: 0.9,
      relevance: 0.95,
      confidence: 0.9,
      freshness: 0.9,
      offlineText: 'High priority',
    };

    const candidateLow: ProactiveCandidate = {
      id: 'c_low',
      type: 'check_in',
      urgency: 0.3,
      relevance: 0.4,
      confidence: 0.5,
      freshness: 0.5,
      offlineText: 'Low priority',
    };

    const scoreHigh = socialDecisionEngine.calculatePriority(candidateHigh, mockState);
    const scoreLow = socialDecisionEngine.calculatePriority(candidateLow, mockState);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('selects strictly the best candidate from multiple options', () => {
    const candidates: ProactiveCandidate[] = [
      {
        id: 'c1',
        type: 'check_in',
        urgency: 0.4,
        relevance: 0.5,
        confidence: 0.6,
        freshness: 0.7,
        offlineText: 'Check in',
      },
      {
        id: 'c2',
        type: 'commitment_followup',
        topic: 'Rotation',
        urgency: 0.95,
        relevance: 0.9,
        confidence: 0.9,
        freshness: 0.95,
        offlineText: 'Rotation follow up',
      },
    ];

    const best = socialDecisionEngine.selectBestCandidate(
      candidates,
      mockState,
      Date.now() - 50 * 60 * 1000,
      Date.now()
    );

    expect(best).not.toBeNull();
    expect(best?.candidate.id).toBe('c2');
  });
});
