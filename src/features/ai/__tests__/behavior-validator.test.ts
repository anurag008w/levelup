import { describe, it, expect, beforeEach } from 'vitest';
import { validateProactiveDelivery } from '../behavior-validator';
import { DEFAULT_RELATIONSHIP_STATE, type RelationshipState } from '../relationship-state';

describe('BehaviorValidator', () => {
  let mockState: RelationshipState;
  const afternoonTimestamp = new Date('2026-09-01T14:30:00.000Z').getTime();

  beforeEach(() => {
    mockState = {
      ...DEFAULT_RELATIONSHIP_STATE,
      boundaries: {
        dndUntilTimestamp: 0,
        quietHoursStart: '03:00',
        quietHoursEnd: '06:00',
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

  it('suppresses message when DND shield is active', () => {
    mockState.boundaries.dndUntilTimestamp = afternoonTimestamp + 3600000;
    const result = validateProactiveDelivery(
      { id: '1', type: 'check_in', urgency: 0.8, relevance: 0.8, confidence: 0.8, freshness: 0.8, offlineText: 'Test' },
      mockState,
      { lastActiveTimestamp: afternoonTimestamp - 45 * 60000, now: afternoonTimestamp }
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('DND');
  });

  it('suppresses background message during active 30-min grace period', () => {
    const lastActive = afternoonTimestamp - 10 * 60000; // 10 min ago
    const result = validateProactiveDelivery(
      { id: '1', type: 'check_in', urgency: 0.8, relevance: 0.8, confidence: 0.8, freshness: 0.8, offlineText: 'Test' },
      mockState,
      { lastActiveTimestamp: lastActive, isInsideActiveSession: false, now: afternoonTimestamp }
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('grace shield');
  });

  it('allows in-session follow-up within active session during grace period', () => {
    const lastActive = afternoonTimestamp - 5 * 60000;
    const result = validateProactiveDelivery(
      { id: '1', type: 'session_followup', urgency: 0.8, relevance: 0.8, confidence: 0.8, freshness: 0.8, offlineText: 'Test in session' },
      mockState,
      { lastActiveTimestamp: lastActive, isInsideActiveSession: true, now: afternoonTimestamp }
    );
    expect(result.valid).toBe(true);
  });

  it('suppresses message referencing an already-completed task', () => {
    const result = validateProactiveDelivery(
      { id: '1', type: 'commitment_followup', topic: 'Optics', urgency: 0.8, relevance: 0.8, confidence: 0.8, freshness: 0.8, offlineText: 'Optics test' },
      mockState,
      { lastActiveTimestamp: afternoonTimestamp - 45 * 60000, completedTaskIds: ['todo_optics_ray_diagram'], now: afternoonTimestamp }
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already completed');
  });

  it('suppresses exact duplicate text sent recently', () => {
    const result = validateProactiveDelivery(
      { id: '1', type: 'check_in', urgency: 0.8, relevance: 0.8, confidence: 0.8, freshness: 0.8, offlineText: 'Already sent message' },
      mockState,
      { lastActiveTimestamp: afternoonTimestamp - 45 * 60000, recentSentMessages: ['Already sent message'], now: afternoonTimestamp }
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('duplicate');
  });
});
