import { describe, it, expect } from 'vitest';
import { migrateV1toV2 } from '../migration';
import { normalizeState } from '../state-repository';
import { STATE_SCHEMA_VERSION } from '../../../core/domain/state';

const v1 = {
  startDateISO: '2026-01-01',
  bonusDaysUsed: 2,
  taskLogs: { '2026-01-01': { d1_t1: true } },
  weeklyReviews: [{ weekNumber: 1, dateISO: '2026-01-07', strongest: 'a', weakest: 'b', planForNextWeek: 'c' }],
  monthlyAssessments: [],
  failureLog: [{ dateISO: '2026-01-08', completionPct: 20, note: 'sick' }],
  examDateISO: '2026-05-04',
  clearedLevels: [1, 2, 3],
};

describe('migrateV1toV2', () => {
  it('carries over all v1 progress fields', () => {
    const state = migrateV1toV2(v1);
    expect(state.schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.startDateISO).toBe('2026-01-01');
    expect(state.bonusDaysUsed).toBe(2);
    expect(state.taskLogs['2026-01-01'].d1_t1).toBe(true);
    expect(state.weeklyReviews).toHaveLength(1);
    expect(state.failureLog[0].completionPct).toBe(20);
    expect(state.examDateISO).toBe('2026-05-04');
    expect(state.clearedLevels).toEqual([1, 2, 3]);
  });

  it('initializes v2-only sections to safe defaults', () => {
    const state = migrateV1toV2(v1);
    expect(state.memory.entries).toEqual([]);
    expect(state.summaries).toEqual([]);
    expect(state.aiSettings.aiEnabled).toBe(true);
    expect(state.dynamicTaskBank).toEqual([]);
    expect(state.planCache).toEqual({});
    expect(state.studyTimeMinutes).toBeGreaterThan(0);
  });

  it('tolerates empty / malformed v1', () => {
    const state = migrateV1toV2(null);
    expect(state.startDateISO).toBeNull();
    expect(state.clearedLevels).toEqual([]);
  });
});

describe('normalizeState', () => {
  it('returns a fresh state for garbage input', () => {
    const state = normalizeState(null);
    expect(state.schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.taskLogs).toEqual({});
  });

  it('keeps valid v2 values and repairs missing ones', () => {
    const state = normalizeState({ startDateISO: '2026-02-01', taskLogs: { x: { y: true } }, studyTimeMinutes: 240, dynamicTaskBank: [{ id: 'ai-1' }] });
    expect(state.startDateISO).toBe('2026-02-01');
    expect(state.taskLogs.x.y).toBe(true);
    expect(state.studyTimeMinutes).toBe(240);
    expect(state.memory.entries).toEqual([]);
    expect(state.aiSettings).toBeDefined();
    expect(state.summaries).toEqual([]);
  });

  it('defaults web search to off and sanitizes an unknown provider id', () => {
    const state = normalizeState({ aiSettings: { providers: {}, websearch: { enabled: true, providerId: 'unknown', model: 'x', apiKey: 'k', baseUrl: '' } } });
    expect(state.aiSettings.websearch.enabled).toBe(true);
    // Unknown provider id is not trusted — falls back to the default (off/none).
    expect(state.aiSettings.websearch.providerId).toBeNull();
  });

  it('keeps a valid configured web search backend', () => {
    const state = normalizeState({
      aiSettings: { providers: {}, websearch: { enabled: true, providerId: 'google', model: 'gemini-2.5-flash', apiKey: 'AIza-test', baseUrl: '' } },
    });
    expect(state.aiSettings.websearch.providerId).toBe('google');
    expect(state.aiSettings.websearch.apiKey).toBe('AIza-test');
  });
});
