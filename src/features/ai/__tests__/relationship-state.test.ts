import { describe, it, expect, beforeEach } from 'vitest';
import { relationshipManager } from '../relationship-state';

describe('RelationshipManager', () => {
  beforeEach(() => {
    relationshipManager.resetForTesting();
  });

  it('manages commitments lifecycle from planned to completed', () => {
    const comm = relationshipManager.addCommitment({
      sourceText: 'kal optics ke pyqs solve karunga',
      topic: 'Optics',
      subject: 'Physics',
      targetDate: '2026-09-01',
      state: 'PLANNED',
    });

    expect(comm.state).toBe('PLANNED');
    expect(comm.topic).toBe('Optics');

    // Transition to STARTED
    const started = relationshipManager.updateCommitmentState(comm.id, 'STARTED');
    expect(started?.state).toBe('STARTED');

    // Transition to COMPLETED
    const completed = relationshipManager.updateCommitmentState(comm.id, 'COMPLETED');
    expect(completed?.state).toBe('COMPLETED');
  });

  it('handles commitment postponement and increments counter', () => {
    const comm = relationshipManager.addCommitment({
      sourceText: 'today integration test',
      topic: 'Calculus',
      subject: 'Mathematics',
      targetDate: '2026-09-01',
      state: 'PLANNED',
    });

    const postponed = relationshipManager.updateCommitmentState(comm.id, 'POSTPONED');
    expect(postponed?.state).toBe('POSTPONED');
    expect(postponed?.postponedCount).toBe(1);
  });

  it('manages durable struggles with confidence decay upon repeated success', () => {
    const mem = relationshipManager.addOrUpdateMemory('struggle', 'Struggling with Optics ray diagrams', 'Optics', 'Physics');
    expect(mem.confidence).toBe(0.85);
    expect(mem.isMastered).toBe(false);

    // 1st success
    relationshipManager.reinforceTopicSuccess('Optics');
    let state = relationshipManager.getState();
    expect(state.durableMemories[0].successCount).toBe(1);
    expect(state.durableMemories[0].confidence).toBeLessThan(0.85);

    // 2nd and 3rd success -> Marks mastered
    relationshipManager.reinforceTopicSuccess('Optics');
    relationshipManager.reinforceTopicSuccess('Optics');
    state = relationshipManager.getState();
    expect(state.durableMemories[0].isMastered).toBe(true);
  });

  it('applies notification dismissal fatigue and cooldowns', () => {
    relationshipManager.recordNotificationDismissal('Rotation');
    const state = relationshipManager.getState();
    expect(state.fatigue.consecutiveDismissals).toBe(1);
    expect(state.fatigue.fatigueScore).toBeGreaterThan(0);
    expect(state.fatigue.topicCooldowns['rotation']).toBeGreaterThan(Date.now());
  });
});
