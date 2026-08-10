import { describe, it, expect } from 'vitest';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import { defaultChatPrefs, MAX_MESSAGES_PER_SESSION, MAX_SESSIONS, type ChatSession } from '../../../core/domain/chat';
import type { StateStore } from '../../../core/ports/repositories';
import type { PhaseId, TaskBankEntry } from '../../../core/domain/task-bank';
import {
  BACKUP_SCOPES,
  BackupError,
  applyBackup,
  buildBackupPayload,
  formatBytes,
  normalizeChatSessions,
  parseBackup,
  serializeBackup,
  summarizeBackup,
  type BackupPayload,
} from '../backup.service';

class FakeStore implements StateStore {
  current: AppState = emptyAppState();
  saved: AppState[] = [];
  get() {
    return this.current;
  }
  save(state: AppState) {
    this.saved.push(state);
    this.current = state;
  }
}

function session(id: string, messageCount = 1, content = 'msg'): ChatSession {
  return {
    id,
    title: `Session ${id}`,
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: `${id}-m${i}`,
      role: 'user' as const,
      content: `${content} ${i}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    prefs: defaultChatPrefs(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fakeTask(id: string, title: string, phase: PhaseId = 'jee-core'): TaskBankEntry {
  return {
    id,
    title,
    habitId: `habit-${id}`,
    description: '',
    phase,
    difficulty: 2,
    estimatedDurationMin: 30,
    energyLevel: 'medium',
    tags: [],
    prerequisites: [],
    taskType: 'Review',
    revisionSuitability: 0.5,
    backlogSuitability: 0.5,
    thinkingSkills: ['focus'],
    jeeRelevance: { score: 0.5 },
    unlockConditions: [{ type: 'day', fromDay: 1 }],
    active: true,
  };
}

function payloadFor(json: string): ReturnType<typeof parseBackup> {
  return parseBackup(json);
}

describe('backup round-trip', () => {
  it('exports state + chat and restores both into a fresh store', () => {
    const store = new FakeStore();
    let replaced: ChatSession[] | null = null as ChatSession[] | null;
    const state = emptyAppState();
    state.startDateISO = '2026-06-01';
    state.dynamicTaskBank = [fakeTask('dyn-1', 'Revise Electrostatics')];

    const backup = buildBackupPayload(state, { version: 1, sessions: [session('s1'), session('s2', 3)] });
    const json = serializeBackup(backup);
    const payload = payloadFor(json);

    const summary = applyBackup(payload, {
      store,
      chat: { replaceStore: (sessions) => { replaced = sessions; } },
    });

    expect(store.saved).toHaveLength(1);
    expect(store.current.startDateISO).toBe('2026-06-01');
    expect(store.current.dynamicTaskBank).toHaveLength(1);
    expect(replaced).toHaveLength(2);
    expect(replaced?.[1].messages).toHaveLength(3);
    expect(summary.state.journeyStarted).toBe(true);
    expect(summary.chat.sessions).toBe(2);
    expect(summary.chat.messages).toBe(4);
  });

  it('parses the pretty-printed envelope fields', () => {
    const payload = buildBackupPayload(emptyAppState(), null);
    const parsed = parseBackup(serializeBackup(payload));
    expect(parsed.app).toBe('levelup');
    expect(parsed.kind).toBe('levelup-backup');
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(parsed.data.state).toBeDefined();
  });

  it('accepts backup JSON wrapped in markdown fences or with a UTF-8 BOM', () => {
    const payload = buildBackupPayload(emptyAppState(), null);
    const plain = serializeBackup(payload);
    expect(parseBackup('```json\n' + plain + '\n```').kind).toBe('levelup-backup');
    expect(parseBackup('\uFEFF' + plain).kind).toBe('levelup-backup');
    expect(parseBackup('  ' + plain + '\n').kind).toBe('levelup-backup');
  });

  it('defaults scope to full for legacy backups that omit it', () => {
    const legacy = JSON.stringify({ app: 'levelup', kind: 'levelup-backup', version: 1, exportedAt: 'x', data: { state: {} } });
    const parsed = parseBackup(legacy);
    expect(parsed.scope).toBe('full');
  });

  it('rejects an unknown backup scope', () => {
    const bad = JSON.stringify({ app: 'levelup', kind: 'levelup-backup', version: 1, scope: 'chat', exportedAt: 'x', data: { state: {} } });
    expect(() => parseBackup(bad)).toThrowError(/backup/i);
  });

  it('exposes every supported scope constant', () => {
    expect(BACKUP_SCOPES).toEqual(['full', 'tasks', 'levels']);
  });

  it('normalizes a missing/garbage state section to an empty state instead of failing', () => {
    const store = new FakeStore();
    const payload: BackupPayload = { app: 'levelup', kind: 'levelup-backup', version: 1, scope: 'full', exportedAt: 'x', data: { state: 'garbage', chat: null } };
    const summary = applyBackup(payload, { store });
    expect(store.saved).toHaveLength(1);
    expect(summary.state.journeyStarted).toBe(false);
    expect(summary.chat.sessions).toBe(0);
  });

  it('writes nothing before validating: TOO_LARGE leaves the store untouched', () => {
    const store = new FakeStore();
    const payload = buildBackupPayload(emptyAppState(), { version: 1, sessions: [session('s1', 5)] });
    expect(() => applyBackup(payload, { store }, { maxBytes: 10 })).toThrowError(BackupError);
    expect(store.saved).toHaveLength(0);
  });
});

describe('parseBackup validation', () => {
  it('rejects malformed JSON', () => {
    expect(() => parseBackup('{not json')).toThrowError(/JSON/i);
  });

  it('rejects an empty file', () => {
    expect(() => parseBackup('')).toThrowError(/JSON/i);
  });

  it('rejects a JSON file that is not an object', () => {
    expect(() => parseBackup('"hello"')).toThrowError(/backup/i);
  });

  it('rejects a wrong app/kind', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'other', kind: 'levelup-backup', version: 1, exportedAt: 'x', data: {} }))).toThrowError(/backup/i);
  });

  it('rejects an unsupported version', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'levelup', kind: 'levelup-backup', version: 99, exportedAt: 'x', data: {} }))).toThrowError(/backup/i);
  });

  it('rejects when the data section is missing entirely', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'levelup', kind: 'levelup-backup', version: 1, exportedAt: 'x' }))).toThrowError(/backup/i);
  });
});

describe('TOO_LARGE guard', () => {
  it('rejects a huge chat payload before applying anything', () => {
    const store = new FakeStore();
    const sessions = Array.from({ length: MAX_SESSIONS }, (_, i) => session(`big-${i}`, MAX_MESSAGES_PER_SESSION, 'x'.repeat(2200)));
    const payload = buildBackupPayload(emptyAppState(), { version: 1, sessions });
    const json = serializeBackup(payload);

    expect(json.length).toBeGreaterThan(4_000_000);
    let errorCode: string | undefined;
    try {
      applyBackup(payloadFor(json), { store });
    } catch (err) {
      if (err instanceof Error && 'code' in err) errorCode = (err as { code: string }).code;
    }
    expect(errorCode).toBe('TOO_LARGE');
    expect(store.saved).toHaveLength(0);
  });
});

describe('backup scopes (tasks / levels)', () => {
  function richState(): AppState {
    const state = emptyAppState();
    state.startDateISO = '2026-06-01';
    state.dynamicTaskBank = [fakeTask('dyn-1', 'Revise')];
    state.taskLogs['2026-06-01'] = { 'dyn-1': true } as AppState['taskLogs'][string];
    state.planCache['2026-06-01'] = {} as AppState['planCache'][string];
    state.restDays = [7];
    state.testDays = [14];
    state.clearedLevels = [1, 2];
    state.weeklyReviews = [{ weekNumber: 1, dateISO: '2026-06-07', strongest: 'a', weakest: 'b', planForNextWeek: 'c' }];
    state.monthlyAssessments = [{ monthNumber: 1, dateISO: '2026-06-30', reflection: 'ok' }];
    state.memory.entries = [{ id: 'm1', type: 'journal', content: 'note', importance: 0.5, summarized: false, source: 'user', createdAt: 'x', context: { tags: [] } }];
    return state;
  }

  it('tasks scope exports ONLY task data, no chat', () => {
    const payload = buildBackupPayload(richState(), { version: 1, sessions: [session('s1')] }, 'tasks');
    const state = payload.data.state as AppState;
    expect(payload.scope).toBe('tasks');
    expect(payload.data.chat).toBeUndefined();
    expect(state).toHaveProperty('dynamicTaskBank');
    expect(state).toHaveProperty('customHabits');
    expect(state).toHaveProperty('taskLogs');
    expect(state).toHaveProperty('planCache');
    expect(state).toHaveProperty('restDays');
    expect(state).toHaveProperty('testDays');
    // Non-task sections must NOT leak into a tasks export.
    expect(state).not.toHaveProperty('clearedLevels');
    expect(state).not.toHaveProperty('memory');
    expect(state).not.toHaveProperty('aiSettings');
    expect(state).not.toHaveProperty('postJourney');
  });

  it('levels scope exports ONLY progression data, no chat', () => {
    const payload = buildBackupPayload(richState(), { version: 1, sessions: [session('s1')] }, 'levels');
    const state = payload.data.state as AppState;
    expect(payload.scope).toBe('levels');
    expect(payload.data.chat).toBeUndefined();
    expect(state).toHaveProperty('clearedLevels');
    expect(state).toHaveProperty('weeklyReviews');
    expect(state).toHaveProperty('monthlyAssessments');
    expect(state).toHaveProperty('postJourney');
    expect(state).not.toHaveProperty('dynamicTaskBank');
    expect(state).not.toHaveProperty('taskLogs');
    expect(state).not.toHaveProperty('memory');
    expect(state).not.toHaveProperty('aiSettings');
  });

  it('tasks import merges into the live store and leaves chat + memory untouched', () => {
    const store = new FakeStore();
    store.current = richState(); // pre-existing memory / cleared levels / chat lives here
    let replaced: ChatSession[] | null = null as ChatSession[] | null;

    const incoming = emptyAppState();
    incoming.dynamicTaskBank = [fakeTask('new-task', 'New')];
    incoming.taskLogs['2026-06-02'] = { 'new-task': true } as AppState['taskLogs'][string];
    const payload = buildBackupPayload(incoming, null, 'tasks');

    const summary = applyBackup(payload, { store, chat: { replaceStore: (s) => { replaced = s; } } });

    // Tasks merged in…
    expect(store.current.dynamicTaskBank.map((t) => t.id)).toContain('new-task');
    expect(store.current.taskLogs['2026-06-02']?.['new-task']).toBe(true);
    // …while everything else survives.
    expect(store.current.clearedLevels).toEqual([1, 2]);
    expect(store.current.memory.entries).toHaveLength(1);
    expect(store.current.startDateISO).toBe('2026-06-01');
    // Chat was never touched by a scoped import.
    expect(replaced).toBeNull();
    expect(summary.scope).toBe('tasks');
  });

  it('levels import merges into the live store and leaves tasks + chat untouched', () => {
    const store = new FakeStore();
    store.current = richState();
    let replaced: ChatSession[] | null = null as ChatSession[] | null;

    const incoming = emptyAppState();
    incoming.clearedLevels = [1, 2, 3];
    incoming.weeklyReviews = [{ weekNumber: 1, dateISO: '2026-06-07', strongest: 'x', weakest: 'y', planForNextWeek: 'z' }];
    incoming.monthlyAssessments = [{ monthNumber: 1, dateISO: '2026-06-30', reflection: 'from backup' }];
    const payload = buildBackupPayload(incoming, null, 'levels');

    const summary = applyBackup(payload, { store, chat: { replaceStore: (s) => { replaced = s; } } });

    expect(store.current.clearedLevels).toEqual([1, 2, 3]);
    expect(store.current.weeklyReviews).toHaveLength(1);
    expect(store.current.monthlyAssessments[0].reflection).toBe('from backup'); // replaced by backup
    expect(store.current.dynamicTaskBank).toHaveLength(1); // untouched
    expect(replaced).toBeNull();
    expect(summary.scope).toBe('levels');
  });

  it('full scope still carries chat and replaces everything', () => {
    const store = new FakeStore();
    let replaced: ChatSession[] | null = null as ChatSession[] | null;
    const state = richState();
    const payload = buildBackupPayload(state, { version: 1, sessions: [session('s1', 2)] }, 'full');
    applyBackup(payload, { store, chat: { replaceStore: (s) => { replaced = s; } } });
    expect(payload.data.chat).toBeDefined();
    expect(replaced).toHaveLength(1);
    expect(replaced?.[0].messages).toHaveLength(2);
    expect(store.current.clearedLevels).toEqual([1, 2]);
    expect(summarizeBackup(store.current, replaced ?? [], 1, 'full').scope).toBe('full');
  });

  it('full export strips the regenerable model catalog (modelCache)', () => {
    const state = richState();
    state.aiSettings = {
      ...state.aiSettings,
      modelCache: { openrouter: [{ id: 'm1', name: 'M1', provider: 'openrouter', contextLength: 0, modalities: { input: ['text'], output: ['text'] }, supportsStreaming: false, supportsVision: false, supportsReasoning: false, supportsToolCalling: false, supportsStructuredOutputs: false, supportsThinking: false, pricing: null, isFree: false, deprecated: false, fetchedAt: 1 }] },
    };
    const payload = buildBackupPayload(state, null, 'full');
    const exported = payload.data.state as AppState;
    expect(exported.aiSettings.modelCache).toEqual({});
    // Provider API keys must still travel with a full backup.
    expect(state.aiSettings.providers).toBeDefined();
  });

  it('legacy full backups (no scope) restore as full replace', () => {
    const store = new FakeStore();
    const legacy = JSON.stringify({ app: 'levelup', kind: 'levelup-backup', version: 1, exportedAt: 'x', data: { state: { startDateISO: '2026-06-01' } } });
    const summary = applyBackup(parseBackup(legacy), { store });
    expect(summary.scope).toBe('full');
    expect(store.current.startDateISO).toBe('2026-06-01');
  });
});

describe('normalizeChatSessions', () => {
  it('caps sessions and messages to the same limits the app enforces', () => {
    const sessions = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => session(`s${i}`, MAX_MESSAGES_PER_SESSION + 50));
    const normalized = normalizeChatSessions({ version: 1, sessions });
    expect(normalized).toHaveLength(MAX_SESSIONS);
    expect(normalized[0].messages).toHaveLength(MAX_MESSAGES_PER_SESSION);
  });

  it('drops invalid sessions and garbage messages', () => {
    const raw = {
      sessions: [
        null,
        'junk',
        { id: 'ok', title: 'Good', messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 'x' }], prefs: null, createdAt: 'x', updatedAt: 'x' },
        { id: 'bad', title: 'Bad', messages: [{ id: 'm2', role: 'system', content: 'hi' }, 'nope', { id: 'm3', role: 'assistant', content: 'ok' }], createdAt: 'x', updatedAt: 'x' },
      ],
    };
    const normalized = normalizeChatSessions(raw);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].messages).toHaveLength(1);
    expect(normalized[1].messages).toHaveLength(1);
  });

  it('returns an empty list for a non-record chat section', () => {
    expect(normalizeChatSessions(null)).toEqual([]);
    expect(normalizeChatSessions('garbage')).toEqual([]);
    expect(normalizeChatSessions({})).toEqual([]);
    expect(normalizeChatSessions({ sessions: 'not-an-array' })).toEqual([]);
  });

  it('keeps memorySummarizedAt / aiSummarizedAt when present', () => {
    const normalized = normalizeChatSessions({
      sessions: [
        { id: 's1', title: 'T', messages: [], prefs: {}, createdAt: 'x', updatedAt: 'x', memorySummarizedAt: '2026-01-01T00:00:00.000Z', aiSummarizedAt: '2026-01-02T00:00:00.000Z' },
      ],
    });
    expect(normalized[0].memorySummarizedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(normalized[0].aiSummarizedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('summarizeBackup + formatBytes', () => {
  it('counts tasks, memory, cached plan days and dynamic phases', () => {
    const state = emptyAppState();
    state.startDateISO = '2026-06-01';
    state.taskLogs['2026-06-01'] = { t1: true, t2: false, t3: true };
    state.dynamicTaskBank = [
      fakeTask('d1', 'x', 'jee-core'),
      fakeTask('d2', 'y', 'l-mindset'),
      fakeTask('d3', 'z', 'l-mindset'),
    ];
    state.planCache = { '2026-06-01': {} as AppState['planCache'][string], '2026-06-02': {} as AppState['planCache'][string] };
    state.memory.entries = [{ id: 'e1', type: 'journal', content: 'hello', createdAt: 'x', importance: 0.5, summarized: false, source: 'user', context: { tags: [] } }];

    const summary = summarizeBackup(state, [session('s1', 2)], 123);
    expect(summary.state.totalDone).toBe(2);
    expect(summary.state.dynamicTasks).toBe(3);
    expect(summary.state.dynamicPhases).toEqual(['jee-core', 'l-mindset']);
    expect(summary.state.planDays).toBe(2);
    expect(summary.state.memoryEntries).toBe(1);
    expect(summary.chat.messages).toBe(2);
    expect(summary.bytes).toBe(123);
  });

  it('formats byte counts readably', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
