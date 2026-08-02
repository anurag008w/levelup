// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * user-storage functions read/write through the persistentStorage SINGLETON,
 * whose in-memory cache survives localStorage.clear(). Re-import the module
 * fresh per test so each test starts from an empty cache + empty localStorage.
 */
async function fresh() {
  vi.resetModules();
  localStorage.clear();
  return await import('../user-storage');
}

describe('user-storage', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('returns defaults when nothing is saved', async () => {
    const us = await fresh();
    const progress = await us.getUserProgress();
    expect(progress.dailyGoal).toBe(10);
    expect(progress.level).toBe(1);
    const ai = await us.getAISettings();
    expect(ai.temperature).toBe(0.7);
    expect(ai.memoryEnabled).toBe(true);
    const app = await us.getAppSettings();
    expect(app.theme).toBe('system');
    const onboarding = await us.getOnboardingState();
    expect(onboarding.completed).toBe(false);
  });

  it('save merges partial updates', async () => {
    const us = await fresh();
    await us.saveUserProgress({ xp: 50, dailyGoal: 20 });
    const progress = await us.getUserProgress();
    expect(progress.xp).toBe(50);
    expect(progress.dailyGoal).toBe(20);
    expect(progress.level).toBe(1); // untouched default
  });

  it('resetUserProgress restores defaults', async () => {
    const us = await fresh();
    await us.saveUserProgress({ xp: 500, level: 5 });
    await us.resetUserProgress();
    const progress = await us.getUserProgress();
    expect(progress.xp).toBe(0);
    expect(progress.level).toBe(1);
  });

  it('saveAISettings merges onto defaults', async () => {
    const us = await fresh();
    await us.saveAISettings({ temperature: 0.2 });
    const ai = await us.getAISettings();
    expect(ai.temperature).toBe(0.2);
    expect(ai.maxTokens).toBe(2048);
  });

  it('saveAppSettings merges onto defaults', async () => {
    const us = await fresh();
    await us.saveAppSettings({ theme: 'dark' });
    const app = await us.getAppSettings();
    expect(app.theme).toBe('dark');
    expect(app.fontSize).toBe('medium');
  });

  it('completeOnboarding persists the state', async () => {
    const us = await fresh();
    await us.completeOnboarding();
    expect(await us.getOnboardingState()).toEqual({
      completed: true,
      stepsCompleted: ['welcome', 'permissions', 'topic-selection'],
    });
  });

  it('updateStudyStreak starts at 1 for a first study day', async () => {
    const us = await fresh();
    expect(await us.updateStudyStreak()).toBe(1);
  });

  it('updateStudyStreak does not increment twice the same day', async () => {
    const us = await fresh();
    await us.updateStudyStreak();
    expect(await us.updateStudyStreak()).toBe(1);
  });

  it('updateStudyStreak increments on consecutive days', async () => {
    const us = await fresh();
    const { isoDateInTimeZone, deviceTimeZone } = await import('../../../core/ports/clock');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-04T12:00:00Z'));
    const today = isoDateInTimeZone(new Date(), deviceTimeZone());
    const yesterday = isoDateInTimeZone(new Date(Date.now() - 86_400_000), deviceTimeZone());
    await us.saveUserProgress({ studyStreak: 4, lastStudyDate: yesterday });
    expect(await us.updateStudyStreak()).toBe(5);
    expect((await us.getUserProgress()).lastStudyDate).toBe(today);
  });

  it('updateStudyStreak breaks the streak after a gap', async () => {
    const us = await fresh();
    const { isoDateInTimeZone, deviceTimeZone } = await import('../../../core/ports/clock');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-04T12:00:00Z'));
    const today = isoDateInTimeZone(new Date(), deviceTimeZone());
    const threeDaysAgo = isoDateInTimeZone(new Date(Date.now() - 3 * 86_400_000), deviceTimeZone());
    await us.saveUserProgress({ studyStreak: 5, lastStudyDate: threeDaysAgo });
    expect(await us.updateStudyStreak()).toBe(1);
    expect((await us.getUserProgress()).lastStudyDate).toBe(today);
  });

  it('addXP levels up and reports leveledUp', async () => {
    const us = await fresh();
    await us.saveUserProgress({ xp: 90, level: 3 });
    const result = await us.addXP(120);
    expect(result).toEqual({ level: 5, xp: 10, leveledUp: true });
  });

  it('recordQuestionAttempt tracks totals, corrects and daily progress', async () => {
    const us = await fresh();
    await us.recordQuestionAttempt(true);
    await us.recordQuestionAttempt(false);
    const progress = await us.getUserProgress();
    expect(progress.totalQuestionsAttempted).toBe(2);
    expect(progress.correctAnswers).toBe(1);
    expect(progress.todayProgress).toBe(2);
  });

  it('getAccuracy rounds to whole percent', async () => {
    const us = await fresh();
    expect(await us.getAccuracy()).toBe(0);
    await us.saveUserProgress({ totalQuestionsAttempted: 3, correctAnswers: 2 });
    expect(await us.getAccuracy()).toBe(67);
  });
});
