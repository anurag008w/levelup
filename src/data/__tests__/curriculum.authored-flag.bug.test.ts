// Regression: levels 14-30 (days 40-90) carry real, authored lesson content.
// Their habits (3 per level) and daily tasks (3 per level) have lived in the
// task-bank seed since "Add all-phase tasks" — but a previous commit marked the
// whole range `authored: false` via a placeholder helper, so the app showed
// "coming soon" instead of the existing content, and getLevelStatus() returned
// 'pending-content' for more than half the journey. This test locks in that the
// range is fully authored with non-generic metadata.
import { it, expect } from 'vitest';
import { LEVELS, PHASES } from '../curriculum';

it('levels 14-30 are authored and span phases 2-4', () => {
  const levels = LEVELS.filter((l) => l.id >= 14 && l.id <= 30);
  expect(levels.length).toBe(17);
  for (const level of levels) {
    expect(level.authored, `level ${level.id} ("${level.title}") should be authored: true`).toBe(true);
    expect(level.passCriteria.trim().length).toBeGreaterThan(20);
    expect(level.unlockCondition.trim().length).toBeGreaterThan(10);
    expect(level.commonMistakes.length).toBeGreaterThanOrEqual(2);
    expect(level.jeeBenefit.trim().length).toBeGreaterThan(40);
  }
});

it('every phase 2-4 level maps to the right phase', () => {
  const phaseIds = new Set(PHASES.map((p) => p.id));
  for (const level of LEVELS.filter((l) => l.id >= 14)) {
    expect(phaseIds.has(level.phase), `level ${level.id} phase "${level.phase}"`).toBe(true);
    if (level.id <= 21) expect(level.phase).toBe('l-mindset');
    if (level.id >= 22 && level.id <= 27) expect(level.phase).toBe('light-execution');
    if (level.id >= 28) expect(level.phase).toBe('peak-performance');
  }
});
