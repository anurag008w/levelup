import { describe, it, expect } from 'vitest';
import { mergeAppState, mergeChatSessions } from '../sync-merge';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import type { ChatSession } from '../../../core/domain/chat';

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

  it('merges custom todos preserving completed status and new tasks', () => {
    const local: AppState = {
      ...emptyAppState(),
      customTodos: [
        { id: 'todo-1', title: 'Physics HC Verma', completed: true, priority: 'high', category: 'physics', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T12:00:00Z' },
        { id: 'todo-2', title: 'Maths Integration', completed: false, priority: 'medium', category: 'maths', createdAt: '2026-01-01T11:00:00Z' },
      ],
    };
    const remote: AppState = {
      ...emptyAppState(),
      customTodos: [
        { id: 'todo-1', title: 'Physics HC Verma', completed: false, priority: 'high', category: 'physics', createdAt: '2026-01-01T10:00:00Z' },
        { id: 'todo-3', title: 'Chem Organic Revision', completed: true, priority: 'high', category: 'chemistry', createdAt: '2026-01-01T13:00:00Z' },
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
});
