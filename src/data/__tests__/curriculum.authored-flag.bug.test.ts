// Regression: `placeholder()` in src/data/curriculum.ts builds levels 14-30
// (days 40-90, i.e. more than half of the 90-day journey). Everything about
// that helper signals "this content isn't written yet": empty `newHabitIds`,
// a generic `passCriteria`/`jeeBenefit`, and a name of literally "placeholder".
// It used to hardcode `authored: true`, which meant the app silently showed
// "0 habits" / "0 tasks" detail screens for days 40-90 instead of the intended
// "coming soon" messaging, and getLevelStatus()'s 'pending-content' status was
// unreachable dead code. This test locks the intended behavior in.
import { it, expect } from 'vitest';
import { LEVELS } from '../curriculum';

it('placeholder-generated levels (14-30) are NOT marked as authored', () => {
  const placeholderLevels = LEVELS.filter((l) => l.id >= 14 && l.id <= 30);
  expect(placeholderLevels.length).toBe(17);
  for (const level of placeholderLevels) {
    expect(level.authored, `level ${level.id} ("${level.title}") should be authored: false`).toBe(false);
  }
});
