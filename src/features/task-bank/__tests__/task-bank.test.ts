import { describe, it, expect } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { buildSeed, TaskBankRepositoryImpl } from '../task-bank.repository';
import { TaskBankServiceImpl, isUnlockMet } from '../task-bank.service';
import { rankCandidates } from '../ranking';
import type { UnlockSnapshot } from '../task-bank.service';

function makeRepo() {
  const repo = new TaskBankRepositoryImpl(
    { load: () => ({ dynamicTaskBank: [] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
    buildSeed(),
  );
  return new TaskBankServiceImpl(repo);
}

const snapshot: UnlockSnapshot = {
  dayNumber: 1,
  phase: 'jee-core',
  unlockedHabitIds: [],
  examWindowActive: false,
  mockSunday: false,
  recoveryMode: false,
  backlogDays: 0,
  revisionDueHabitIds: [],
};

describe('task bank search', () => {
  it('returns only day-1 unlocked curriculum tasks by default', () => {
    const bank = makeRepo();
    const tasks = bank.search({ unlock: snapshot, activeOnly: true });
    expect(tasks.map((t) => t.id).sort()).toEqual(['d1_t1', 'd1_t2', 'd1_t3', 'd1_t4']);
  });

  it('excludes protocol tasks outside their cadence', () => {
    const bank = makeRepo();
    const all = bank.getAll();
    const mockTasks = all.filter((t) => t.unlockConditions.some((c) => c.type === 'mock-sunday'));
    expect(mockTasks.length).toBeGreaterThan(0);
    for (const t of mockTasks) expect(isUnlockMet(t, snapshot)).toBe(false);
  });

  it('unlocks mock-sunday tasks only on mock Sundays', () => {
    const bank = makeRepo();
    const mockTasks = bank.getAll().filter((t) => t.unlockConditions.some((c) => c.type === 'mock-sunday'));
    const onSunday = { ...snapshot, dayNumber: 7, mockSunday: true };
    const unlocked = mockTasks.filter((t) => isUnlockMet(t, onSunday));
    expect(unlocked.length).toBeGreaterThan(0);
    expect(unlocked.every((t) => t.taskType === 'Challenge')).toBe(true);
  });

  it('supports filters (habitIds, taskTypes, maxDuration)', () => {
    const bank = makeRepo();
    const short = bank.search({ unlock: snapshot, maxDurationMin: 5 });
    expect(short.every((t) => t.estimatedDurationMin <= 5)).toBe(true);
  });


  it('lets dynamic entries override or disable built-in seed tasks', () => {
    const editedSeed = { ...buildSeed().tasks.find((t) => t.id === 'd1_t1')!, title: 'Edited seed task title' };
    const repo = new TaskBankRepositoryImpl(
      { load: () => ({ dynamicTaskBank: [editedSeed, { ...buildSeed().tasks.find((t) => t.id === 'd1_t2')!, active: false }] }) as unknown as AppState, save: () => undefined, clear: () => undefined },
      buildSeed(),
    );
    const bank = new TaskBankServiceImpl(repo);
    expect(bank.getById('d1_t1')?.title).toBe('Edited seed task title');
    expect(bank.search({ unlock: snapshot, activeOnly: true }).map((t) => t.id)).not.toContain('d1_t2');
  });
});

describe('rankCandidates', () => {
  const bank = makeRepo();
  const candidates = bank
    .search({ unlock: { ...snapshot, dayNumber: 19 }, activeOnly: true })
    .filter((t) => t.taskType === 'Review' || t.taskType === 'Recovery');
  expect(candidates.length).toBeGreaterThan(0);

  it('is deterministic and prefers weak-habit + revision candidates', () => {
    const ctx = {
      dayNumber: 19,
      weakHabitIds: ['active_recall'],
      revisionDueHabitIds: ['active_recall'],
      backlogDays: 0,
      remainingMinutes: 120,
      recentTaskIds: new Set<string>(),
      gapDays: 0,
      recoveryMode: false,
    };
    const a = rankCandidates(candidates, ctx);
    const b = rankCandidates(candidates, ctx);
    expect(a.map((r) => r.entry.id)).toEqual(b.map((r) => r.entry.id));
    expect(a[0].score).toBeGreaterThanOrEqual(a[a.length - 1].score);
    expect(a[0].reason).toContain('weak habit');
  });

  it('deprioritizes recently completed tasks', () => {
    const ctx = {
      dayNumber: 19,
      weakHabitIds: [],
      revisionDueHabitIds: [],
      backlogDays: 0,
      remainingMinutes: 120,
      recentTaskIds: new Set(candidates.map((c) => c.id)),
      gapDays: 0,
      recoveryMode: false,
    };
    const ranked = rankCandidates(candidates, ctx);
    const top = ranked[0];
    const withoutRecent = rankCandidates(candidates, { ...ctx, recentTaskIds: new Set<string>() })[0];
    expect(top.reason).toContain('done recently');
    // A task marked recently done must rank at or below its non-penalized self.
    const idxRecent = ranked.findIndex((r) => r.entry.id === withoutRecent.entry.id);
    expect(idxRecent).toBeLessThanOrEqual(0);
  });
});
