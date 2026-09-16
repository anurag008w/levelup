import { describe, expect, it } from 'vitest';
import { validateProactiveDelivery } from '../behavior-validator';
import { relationshipManager } from '../relationship-state';

describe('validateProactiveDelivery activity timestamp hardening', () => {
  it('fails closed for a negative persisted activity timestamp', () => {
    const relationship = relationshipManager.getState();
    relationship.boundaries.quietHoursStart = '00:00';
    relationship.boundaries.quietHoursEnd = '00:00';

    const now = 1_000_000;
    const result = validateProactiveDelivery(
      {
        id: 'timestamp-negative',
        type: 'check_in',
        topic: 'jee_prep',
        urgency: 0.5,
        relevance: 0.8,
        confidence: 0.9,
        freshness: 0.9,
        offlineText: 'quick check-in',
      },
      relationship,
      { lastActiveTimestamp: -1, now }
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('active in app');
  });

  it('fails closed for a future persisted activity timestamp', () => {
    const relationship = relationshipManager.getState();
    relationship.boundaries.quietHoursStart = '00:00';
    relationship.boundaries.quietHoursEnd = '00:00';

    const now = 1_000_000;
    const result = validateProactiveDelivery(
      {
        id: 'timestamp-future',
        type: 'check_in',
        topic: 'jee_prep',
        urgency: 0.5,
        relevance: 0.8,
        confidence: 0.9,
        freshness: 0.9,
        offlineText: 'quick check-in',
      },
      relationship,
      { lastActiveTimestamp: now + 60_000, now }
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('active in app');
  });
});
