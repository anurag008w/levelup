import { describe, it, expect, vi } from 'vitest';
import type { AppState } from '../../../core/domain/state';
import { emptyAppState } from '../../../core/domain/state';
import type { LLMResponse } from '../../../core/domain/llm';
import type { LLMService } from '../llm.service';
import type { StateStore } from '../../../core/ports/repositories';
import { PhaseGeneratorService, type JourneyStats } from '../phase-generator.service';

function makeStore(initial: Partial<AppState> = {}): StateStore {
  let state: AppState = { ...emptyAppState(), ...initial };
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

function makeService(store: StateStore, complete?: (req: { messages: unknown[] }) => Promise<LLMResponse>) {
  const llm = {
    complete: complete ?? (async () => ({ text: '', model: 'm' } as LLMResponse)),
  } as unknown as LLMService;
  return new PhaseGeneratorService(llm, store);
}

const basicStats: JourneyStats = {
  totalTasks: 100,
  completedTasks: 80,
  accuracy: 85,
  studyHours: 120,
  streakDays: 10,
  clearedLevels: 12,
};

describe('PhaseGeneratorService mastery', () => {
  it('maps overall score to mastery thresholds', () => {
    const store = makeStore();
    const svc = makeService(store);
    // Weighted score: 0.4*accuracy + 0.3*completion + 0.2*min(100,5*streak) + 0.1*cleared/30.
    expect(svc.calculateMastery({ accuracy: 95, totalTasks: 100, completedTasks: 100, streakDays: 30, clearedLevels: 29, studyHours: 10 })).toBe('expert'); // ~97.7
    expect(svc.calculateMastery({ accuracy: 75, totalTasks: 100, completedTasks: 90, streakDays: 15, clearedLevels: 15, studyHours: 10 })).toBe('advanced'); // ~77
    expect(svc.calculateMastery({ accuracy: 55, totalTasks: 100, completedTasks: 75, streakDays: 5, clearedLevels: 5, studyHours: 10 })).toBe('intermediate'); // ~51
    expect(svc.calculateMastery({ accuracy: 10, totalTasks: 100, completedTasks: 0, streakDays: 0, clearedLevels: 0, studyHours: 10 })).toBe('beginner'); // 4
  });

  it('calculateTopicScores extracts topic ids from task ids and normalizes', () => {
    const store = makeStore();
    const svc = makeService(store);
    const state = emptyAppState();
    state.taskLogs['2026-01-01'] = { physics_mechanics_t1: true, physics_mechanics_t2: true, chem_organic_t1: true };
    state.taskLogs['2026-01-02'] = { maths_calc_t1: true };
    const scores = svc.calculateTopicScores(state);
    expect(scores['physics']).toBe(100); // most completed → normalized to 100
    expect(scores['chem']).toBe(50);
    expect(scores['maths']).toBe(50);
    expect(scores['bio']).toBeUndefined();
  });

  it('calculateTopicScores handles an empty journey', () => {
    const svc = makeService(makeStore());
    expect(svc.calculateTopicScores(emptyAppState())).toEqual({});
  });
});

describe('PhaseGeneratorService final stats', () => {
  it('aggregates totals, accuracy, strongest/weakest habits', () => {
    const store = makeStore();
    const svc = makeService(store);
    const state = emptyAppState();
    state.startDateISO = '2026-01-01';
    state.taskLogs['2026-01-01'] = { a_1: true, a_2: true, b_1: false };
    state.taskLogs['2026-01-02'] = { a_1: true, b_1: true };
    state.studyTimeMinutes = 30;
    const stats = svc.generateFinalStats(state);
    // Logs are per-day: a_1 appears twice (once per day), so 4 of 5 marks are done.
    expect(stats.totalTasksCompleted).toBe(4);
    expect(stats.averageAccuracy).toBe(80); // 4/5
    expect(stats.strongestHabit).toBe('a');
    expect(stats.weakestHabit).toBe('b');
    expect(stats.totalStudyHours).toBe(1);
  });

  it('empty journey yields zero stats and N/A habits', () => {
    const svc = makeService(makeStore());
    const stats = svc.generateFinalStats(emptyAppState());
    expect(stats.totalTasksCompleted).toBe(0);
    expect(stats.averageAccuracy).toBe(0);
    expect(stats.strongestHabit).toBe('N/A');
    expect(stats.weakestHabit).toBe('N/A');
  });

  it('isJourneyComplete when 90 days passed or 30 levels cleared', () => {
    const store = makeStore();
    const svc = makeService(store);
    // Level-count path (avoids real-clock dependency). A real journey always
    // has a start date, so isJourneyComplete returns true with 30 clears.
    const state = { ...emptyAppState(), startDateISO: '2026-01-01', clearedLevels: Array.from({ length: 30 }, (_, i) => i + 1) };
    expect(svc.isJourneyComplete(state)).toBe(true);
    expect(svc.isJourneyComplete(emptyAppState())).toBe(false);
  });
});

describe('PhaseGeneratorService suggestions & approval', () => {
  it('generates a phase from an AI JSON response', async () => {
    const complete = vi.fn(async () => ({
      text: '{"name":"Final Sprint","description":"Focused","goals":["g1","g2"],"habits":["h1"],"difficulty":"hard"}',
      model: 'm',
    }));
    const store = makeStore();
    const svc = makeService(store, complete);
    const phase = await svc.generatePhaseSuggestion({
      currentStats: basicStats,
      strongHabits: ['discipline'],
      weakHabits: ['maths'],
      topicsCompleted: ['physics'],
      topicsPending: ['maths'],
      userPreferences: 'morning person',
    });
    expect(phase.name).toBe('Final Sprint');
    expect(phase.createdBy).toBe('ai');
    expect(phase.dayEnd - phase.dayStart).toBe(14);
    expect(phase.difficulty).toBe('hard');
  });

  it('falls back to a basic phase when the AI text is not JSON', async () => {
    const complete = vi.fn(async () => ({ text: 'kuch bhi likha hai', model: 'm' }));
    const store = makeStore();
    const svc = makeService(store, complete);
    const phase = await svc.generatePhaseSuggestion({
      currentStats: basicStats,
      strongHabits: ['discipline'],
      weakHabits: ['maths', 'chem'],
      topicsCompleted: [],
      topicsPending: ['maths'],
    });
    expect(phase.name).toBe('Custom Practice Phase');
    expect(phase.goals).toEqual(['maths', 'chem']);
  });

  it('createCustomPhase marks user ownership and placeholder days', () => {
    const svc = makeService(makeStore());
    const phase = svc.createCustomPhase('My Phase', 'desc', 15, ['goal'], ['habit'], 'easy');
    expect(phase.createdBy).toBe('user');
    expect(phase.name).toBe('My Phase');
    expect(phase.dayStart).toBe(0);
    expect(phase.createdAt).toBeTruthy();
  });

  it('approveAISuggestion moves a pending suggestion into custom phases', () => {
    const store = makeStore({
      postJourney: {
        ...emptyAppState().postJourney,
        pendingAISuggestions: [
          {
            id: 's1', name: 'Sprint', description: 'd', dayStart: 91, dayEnd: 105,
            goals: [], habits: [], difficulty: 'medium', createdBy: 'ai', createdAt: 'x',
          },
        ],
      },
    });
    const svc = makeService(store);
    const next = svc.approveAISuggestion(store.get(), 's1');
    expect(next.postJourney.customPhases).toHaveLength(1);
    expect(next.postJourney.customPhases[0].id).toBe('s1');
    expect(next.postJourney.pendingAISuggestions).toHaveLength(0);
    expect(next.postJourney.activeCustomPhaseId).toBe('s1');
  });

  it('approveAISuggestion no-ops for a missing suggestion', () => {
    const store = makeStore();
    const svc = makeService(store);
    expect(svc.approveAISuggestion(store.get(), 'nope').postJourney.customPhases).toEqual([]);
  });

  it('rejectAISuggestion removes only the target suggestion', () => {
    const suggestion = {
      id: 's1', name: 'Sprint', description: 'd', dayStart: 91, dayEnd: 105,
      goals: [], habits: [], difficulty: 'medium' as const, createdBy: 'ai' as const, createdAt: 'x',
    };
    const store = makeStore({
      postJourney: { ...emptyAppState().postJourney, pendingAISuggestions: [suggestion] },
    });
    const svc = makeService(store);
    const next = svc.rejectAISuggestion(store.get(), 's1');
    expect(next.postJourney.pendingAISuggestions).toHaveLength(0);
    expect(next.postJourney.customPhases).toHaveLength(0);
  });

  it('setActivePhase updates the active custom phase id', () => {
    const store = makeStore();
    const svc = makeService(store);
    expect(svc.setActivePhase(store.get(), 'p1').postJourney.activeCustomPhaseId).toBe('p1');
    expect(svc.setActivePhase(store.get(), null).postJourney.activeCustomPhaseId).toBeNull();
  });
});
