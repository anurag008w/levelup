import { describe, it, expect } from 'vitest';
import { mergeAppState, mergeChatSessions, mergeMisaData } from '../sync-merge';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import type { ChatSession } from '../../../core/domain/chat';
import { DEFAULT_RELATIONSHIP_STATE } from '../../ai/relationship-state';
import type { ProactivePreferences } from '../../ai/proactive-agent.service';
import type { MisaSyncPayload } from '../sync.service';

describe('sync-merge — multi-device smart merge', () => {
  it('merges task logs from two devices non-destructively', () => {
    const local: AppState = {
      ...emptyAppState(),
      startDateISO: '2026-01-01',
      taskLogs: {
        '2026-01-01': { 'task-1': true },
        '2026-01-02': { 'task-2': true },
      },
    };
    const remote: AppState = {
      ...emptyAppState(),
      startDateISO: '2026-01-01',
      taskLogs: {
        '2026-01-01': { 'task-1': true, 'task-3': true },
        '2026-01-03': { 'task-4': true },
      },
    };

    const merged = mergeAppState(local, remote);
    expect(merged.taskLogs['2026-01-01']).toEqual({ 'task-1': true, 'task-3': true });
    expect(merged.taskLogs['2026-01-02']).toEqual({ 'task-2': true });
    expect(merged.taskLogs['2026-01-03']).toEqual({ 'task-4': true });
  });

  it('never lets a stale false erase a completed task from another device', () => {
    const local: AppState = {
      ...emptyAppState(),
      taskLogs: { '2026-01-01': { 'task-1': false, 'task-2': true } },
    };
    const remote: AppState = {
      ...emptyAppState(),
      taskLogs: { '2026-01-01': { 'task-1': true, 'task-3': false } },
    };

    const merged = mergeAppState(local, remote);
    expect(merged.taskLogs['2026-01-01']).toEqual({ 'task-1': true, 'task-2': true, 'task-3': false });
  });

  it('keeps the merge monotonic regardless of device argument order', () => {
    const local: AppState = {
      ...emptyAppState(),
      taskLogs: { '2026-01-01': { 'task-1': true } },
    };
    const remote: AppState = {
      ...emptyAppState(),
      taskLogs: { '2026-01-01': { 'task-1': false } },
    };

    expect(mergeAppState(local, remote).taskLogs['2026-01-01']['task-1']).toBe(true);
    expect(mergeAppState(remote, local).taskLogs['2026-01-01']['task-1']).toBe(true);
  });

  it('merges custom todos preserving completed status and new tasks', () => {
    const local: AppState = {
      ...emptyAppState(),
      customTodos: [
        { id: 'todo-1', title: 'Physics HC Verma', completed: true, priority: 'high', category: 'physics', createdAtISO: '2026-01-01T10:00:00Z', completedAtISO: '2026-01-01T12:00:00Z', createdBy: 'user' },
        { id: 'todo-2', title: 'Maths Integration', completed: false, priority: 'medium', category: 'maths', createdAtISO: '2026-01-01T11:00:00Z', createdBy: 'user' },
      ],
    };
    const remote: AppState = {
      ...emptyAppState(),
      customTodos: [
        { id: 'todo-1', title: 'Physics HC Verma', completed: false, priority: 'high', category: 'physics', createdAtISO: '2026-01-01T10:00:00Z', createdBy: 'user' },
        { id: 'todo-3', title: 'Chem Organic Revision', completed: true, priority: 'high', category: 'chemistry', createdAtISO: '2026-01-01T13:00:00Z', createdBy: 'user' },
      ],
    };

    const merged = mergeAppState(local, remote);
    expect(merged.customTodos).toHaveLength(3);
    const todo1 = merged.customTodos.find((t) => t.id === 'todo-1');
    expect(todo1?.completed).toBe(true);
    expect(merged.customTodos.some((t) => t.id === 'todo-2')).toBe(true);
    expect(merged.customTodos.some((t) => t.id === 'todo-3')).toBe(true);
  });

  it('merges study vault resources across devices', () => {
    const local: AppState = {
      ...emptyAppState(),
      studyVault: [
        { id: 'res-1', name: 'Formulas.pdf', category: 'formula', size: 1024, uploadedAt: '2026-01-01T00:00:00Z' } as never,
      ],
    };
    const remote: AppState = {
      ...emptyAppState(),
      studyVault: [
        { id: 'res-2', name: 'Physics_Notes.pdf', category: 'physics', size: 2048, uploadedAt: '2026-01-01T01:00:00Z' } as never,
      ],
    };

    const merged = mergeAppState(local, remote);
    expect(merged.studyVault).toHaveLength(2);
    expect(merged.studyVault.map((r) => r.id)).toEqual(['res-2', 'res-1']);
  });

  it('merges memory facts without duplicate entries', () => {
    const local: AppState = {
      ...emptyAppState(),
      memory: {
        entries: [
          { id: 'm1', content: 'Weak in rotational dynamics', type: 'preference', createdAt: '2026-01-01', importance: 1, summarized: false, source: 'user', context: { tags: [] } },
          { id: 'm2', content: 'Aiming for Top 500 in JEE', type: 'goal', createdAt: '2026-01-01', importance: 1, summarized: false, source: 'user', context: { tags: [] } },
        ],
        summaries: [],
        lastSummarizedAt: null,
      },
    };
    const remote: AppState = {
      ...emptyAppState(),
      memory: {
        entries: [
          { id: 'm3', content: 'Weak in rotational dynamics', type: 'preference', createdAt: '2026-01-01', importance: 1, summarized: false, source: 'user', context: { tags: [] } },
          { id: 'm4', content: 'Likes step-by-step math derivations', type: 'preference', createdAt: '2026-01-01', importance: 1, summarized: false, source: 'user', context: { tags: [] } },
        ],
        summaries: [],
        lastSummarizedAt: null,
      },
    };

    const merged = mergeAppState(local, remote);
    expect(merged.memory.entries).toHaveLength(3);
  });

  it('merges chat sessions and interleaves messages by timestamp', () => {
    const localSessions: ChatSession[] = [
      {
        id: 'session-1',
        title: 'Thermodynamics Doubts',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:05:00Z',
        prefs: {} as never,
        messages: [
          { id: 'msg-1', role: 'user', content: 'What is Carnot cycle?', createdAt: '2026-01-01T10:00:00Z' },
          { id: 'msg-3', role: 'user', content: 'What is second law?', createdAt: '2026-01-01T10:05:00Z' },
        ],
      },
    ];
    const remoteSessions: ChatSession[] = [
      {
        id: 'session-1',
        title: 'Thermodynamics Doubts',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:02:00Z',
        prefs: {} as never,
        messages: [
          { id: 'msg-1', role: 'user', content: 'What is Carnot cycle?', createdAt: '2026-01-01T10:00:00Z' },
          { id: 'msg-2', role: 'assistant', content: 'Carnot cycle is an ideal reversible cycle...', createdAt: '2026-01-01T10:01:00Z' },
        ],
      },
      {
        id: 'session-2',
        title: 'Calculus Session on Mobile',
        createdAt: '2026-01-01T11:00:00Z',
        updatedAt: '2026-01-01T11:10:00Z',
        prefs: {} as never,
        messages: [],
      },
    ];

    const merged = mergeChatSessions(localSessions, remoteSessions);
    expect(merged).toHaveLength(2);
    const s1 = merged.find((s) => s.id === 'session-1');
    expect(s1?.messages).toHaveLength(3);
    expect(s1?.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('uses the newer session snapshot for conflicting chat metadata and same-id messages', () => {
    const localSessions: ChatSession[] = [{
      id: 'session-1',
      title: 'Stale local title',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:05:00Z',
      prefs: { providerId: 'local-provider', model: 'local-model' } as never,
      messages: [{ id: 'msg-1', role: 'assistant', content: 'stale answer', createdAt: '2026-01-01T10:01:00Z' }],
    }];
    const remoteSessions: ChatSession[] = [{
      id: 'session-1',
      title: 'Authoritative remote title',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:10:00Z',
      prefs: { providerId: 'remote-provider', model: 'remote-model' } as never,
      messages: [{ id: 'msg-1', role: 'assistant', content: 'fresh answer', createdAt: '2026-01-01T10:01:00Z' }],
    }];

    const mergedLocalFirst = mergeChatSessions(localSessions, remoteSessions)[0];
    const mergedRemoteFirst = mergeChatSessions(remoteSessions, localSessions)[0];

    for (const merged of [mergedLocalFirst, mergedRemoteFirst]) {
      expect(merged.title).toBe('Authoritative remote title');
      expect(merged.prefs.providerId).toBe('remote-provider');
      expect(merged.prefs.model).toBe('remote-model');
      expect(merged.messages[0].content).toBe('fresh answer');
      expect(merged.updatedAt).toBe('2026-01-01T10:10:00Z');
    }
  });
});

describe('sync-merge — misa relationship + proactive merge', () => {
  const prefs = (over: Partial<ProactivePreferences> = {}): ProactivePreferences => ({
    enabled: true,
    callsEnabled: true,
    callFrequency: 'balanced',
    quietHoursStart: '01:00',
    quietHoursEnd: '07:00',
    ringtonePreset: 'soft_chime',
    activeGraceMinutes: 30,
    ...over,
  });

  const misa = (over: Partial<MisaSyncPayload> = {}): MisaSyncPayload => ({
    version: 1,
    relationship: {
      ...DEFAULT_RELATIONSHIP_STATE,
      currentGoal: 'JEE Main & Advanced Mastery',
      currentSubject: 'General',
      currentMoodContext: 'neutral',
      currentProblemArea: undefined,
      preferredInteractionStyle: 'gentle_encouragement',
    },
    proactive: {
      prefs: prefs(),
      lastActiveTimestamp: 0,
      lastUserChatTimestamp: 0,
      lastCallTimestamp: 0,
      lastCallDeclinedTimestamp: 0,
      consecutiveCallDeclines: 0,
      dndUntilTimestamp: 0,
      coldStartDone: false,
      pendingTriggers: [],
      scheduledMessages: [],
      missedInteractions: [],
    },
    ...over,
  });

  it('unions commitments and promises from both devices by id', () => {
    const local = misa();
    local.relationship.commitments = [
      { id: 'c1', sourceText: 'finish kinematics', topic: 'kinematics', subject: 'Physics', targetDate: '2026-01-10', state: 'STARTED', createdAt: 1, updatedAt: 1, postponedCount: 0 },
    ];
    const remote = misa();
    remote.relationship.commitments = [
      { id: 'c2', sourceText: 'finish electrostatics', topic: 'electrostatics', subject: 'Physics', targetDate: '2026-01-15', state: 'PLANNED', createdAt: 2, updatedAt: 2, postponedCount: 0 },
    ];

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.commitments.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(merged.relationship.currentGoal).toBe('JEE Main & Advanced Mastery');
  });

  it('keeps the most recent lastInteractionTimestamp', () => {
    const local = misa();
    local.relationship.lastInteractionTimestamp = 100;
    const remote = misa();
    remote.relationship.lastInteractionTimestamp = 200;

    const merged = mergeMisaData(local, remote)!;
    expect(merged.relationship.lastInteractionTimestamp).toBe(200);
  });

  it('preserves both devices scheduled messages without duplicates', () => {
    const local = misa();
    local.proactive.scheduledMessages = [
      { id: 's1', kind: 'message', text: 'revision?', scheduledTime: 100, topic: 'optics', createdAt: 10 },
    ];
    const remote = misa();
    remote.proactive.scheduledMessages = [
      { id: 's2', kind: 'call', reason: 'check-in', scheduledTime: 200, createdAt: 20 },
    ];

    const merged = mergeMisaData(local, remote)!;
    expect(merged.proactive.scheduledMessages).toHaveLength(2);
  });

  it('preserves cancellation across devices even when scheduled ids differ', () => {
    const cancelledOnPhone = misa();
    cancelledOnPhone.proactive.scheduledMessages = [
      {
        id: 'phone-id',
        kind: 'message',
        text: 'optics revision?',
        scheduledTime: 1_800_000_000_000,
        topic: 'optics',
        createdAt: 100,
        cancelled: true,
      },
    ];
    const pendingOnLaptop = misa();
    pendingOnLaptop.proactive.scheduledMessages = [
      {
        id: 'laptop-id',
        kind: 'message',
        text: 'optics revision?',
        scheduledTime: 1_800_000_000_000,
        topic: 'optics',
        createdAt: 200,
        cancelled: false,
      },
    ];

    const merged = mergeMisaData(cancelledOnPhone, pendingOnLaptop)!;
    const reverse = mergeMisaData(pendingOnLaptop, cancelledOnPhone)!;

    expect(merged.proactive.scheduledMessages).toHaveLength(1);
    expect(merged.proactive.scheduledMessages[0].cancelled).toBe(true);
    expect(reverse.proactive.scheduledMessages).toHaveLength(1);
    expect(reverse.proactive.scheduledMessages[0].cancelled).toBe(true);
    expect(merged.proactive.scheduledMessages[0].createdAt).toBe(200);
  });

  it('does not resurrect a cancellation when the cancelled copy is older', () => {
    const olderCancellation = misa();
    olderCancellation.proactive.scheduledMessages = [
      { id: 'cancelled-copy', kind: 'call', reason: 'check in', scheduledTime: 1_900_000_000_000, createdAt: 300, cancelled: true },
    ];
    const newerPending = misa();
    newerPending.proactive.scheduledMessages = [
      { id: 'pending-copy', kind: 'call', reason: 'check in', scheduledTime: 1_900_000_000_000, createdAt: 400, cancelled: false },
    ];

    const merged = mergeMisaData(olderCancellation, newerPending)!;
    expect(merged.proactive.scheduledMessages).toHaveLength(1);
    expect(merged.proactive.scheduledMessages[0].cancelled).toBe(true);
  });

  it('feature ON on either device stays ON after merge', () => {
    const local = misa({ proactive: { ...misa().proactive, prefs: prefs({ enabled: true, callsEnabled: false }) } });
    const remote = misa({ proactive: { ...misa().proactive, prefs: prefs({ enabled: false, callsEnabled: true }) } });

    const merged = mergeMisaData(local, remote)!;
    expect(merged.proactive.prefs.enabled).toBe(true);
    expect(merged.proactive.prefs.callsEnabled).toBe(true);
  });
});
