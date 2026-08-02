import { describe, it, expect } from 'vitest';
import { LEVELS, PHASES, TOTAL_DAYS } from '../curriculum';

describe('curriculum data integrity', () => {
  it('has exactly 30 authored levels spanning all 90 days', () => {
    expect(LEVELS).toHaveLength(30);
    expect(TOTAL_DAYS).toBe(90);
    expect(LEVELS[0].dayStart).toBe(1);
    expect(LEVELS[29].dayEnd).toBe(90);
  });

  it('levels are contiguous, ordered and non-overlapping', () => {
    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i];
      expect(level.id).toBe(i + 1);
      expect(level.dayStart).toBeLessThanOrEqual(level.dayEnd);
      if (i > 0) {
        expect(level.dayStart).toBe(LEVELS[i - 1].dayEnd + 1);
      }
    }
  });

  it('every level belongs to one of the four phases', () => {
    const phaseIds = new Set(PHASES.map((p) => p.id));
    for (const level of LEVELS) {
      expect(phaseIds.has(level.phase)).toBe(true);
    }
  });

  it('phase level ranges match the levels assigned to that phase', () => {
    expect(PHASES).toHaveLength(4);
    for (const phase of PHASES) {
      const inPhase = LEVELS.filter((l) => l.phase === phase.id);
      expect(inPhase.length).toBeGreaterThan(0);
      // levelRange is a LEVEL-ID window, not a day window.
      expect(inPhase[0].id).toBe(phase.levelRange[0]);
      expect(inPhase[inPhase.length - 1].id).toBe(phase.levelRange[1]);
      expect(inPhase.length).toBe(phase.levelRange[1] - phase.levelRange[0] + 1);
    }
  });

  it('authored levels reference non-empty lesson metadata', () => {
    const authored = LEVELS.filter((l) => l.authored);
    expect(authored.length).toBeGreaterThan(0);
    for (const level of authored) {
      expect(level.title).toBeTruthy();
      expect(level.passCriteria).toBeTruthy();
      expect(level.unlockCondition).toBeTruthy();
    }
  });

  it('every level has a unique id and no duplicate day numbers', () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(LEVELS.length);
    const days = LEVELS.flatMap((l) => Array.from({ length: l.dayEnd - l.dayStart + 1 }, (_, i) => l.dayStart + i));
    expect(new Set(days).size).toBe(TOTAL_DAYS);
  });
});
