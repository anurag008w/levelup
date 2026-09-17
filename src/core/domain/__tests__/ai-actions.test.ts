import { describe, expect, it } from 'vitest';
import { emptyAppState } from '../state';
import { AiActionRegistry, AiPermissionEngine, executeAiAction, recordAiActionVersion, undoLastAiAction, redoLastAiAction, createAiActionPreview, type AiActionVersion } from '../ai-actions';

describe('AI action history', () => {
  it('records versions and can undo/redo editable app snapshots', () => {
    const before = emptyAppState();
    const afterBank = [{ id: 'ai-task', title: 'AI task', active: true }] as typeof before.dynamicTaskBank;
    const recorded = recordAiActionVersion(
      { ...before, dynamicTaskBank: afterBank },
      { action: 'addTask', entityType: 'dynamicTaskBank', entityId: 'ai-task', summary: 'add AI task', permissions: ['create'], confirmed: true },
      before.dynamicTaskBank,
      afterBank,
      new Date('2026-08-01T00:00:00Z'),
    );

    expect(recorded.aiActionHistory.versions).toHaveLength(1);
    expect(recorded.dynamicTaskBank).toHaveLength(1);

    const undone = undoLastAiAction(recorded);
    expect(undone.dynamicTaskBank).toHaveLength(0);
    expect(undone.aiActionHistory.undone).toHaveLength(1);

    const redone = redoLastAiAction(undone);
    expect(redone.dynamicTaskBank).toHaveLength(1);
    expect(redone.aiActionHistory.undone).toHaveLength(0);
  });

  it('creates destructive previews without mutating state', () => {
    const preview = createAiActionPreview(
      { action: 'removeTask', entityType: 'dynamicTaskBank', entityId: 'x', summary: 'remove x', permissions: ['delete'] },
      [{ id: 'x' }],
      [],
    );

    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.changedFields).toEqual(['value']);
  });

  it('registers actions and denies execution when permissions are missing', () => {
    const registry = new AiActionRegistry();
    registry.register({ id: 'bulkMarkDone', label: 'Bulk mark done', description: 'bulk', entityType: 'taskLogs', permissions: ['bulk-edit'], confirmationRequired: true });

    const state = emptyAppState();
    const result = executeAiAction({
      state,
      action: registry.require('bulkMarkDone'),
      entityId: '2026-08-01:bulk',
      summary: 'mark all tasks done',
      beforeState: {},
      afterState: { '2026-08-01': { a: true } },
      confirmed: true,
      permissionEngine: new AiPermissionEngine({ allowed: ['read', 'edit'] }),
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('bulk-edit');
    expect(result.state.taskLogs).toEqual({});
  });

  it('undoes only the AI task-log change and preserves a newer completion on another task', () => {
    const before = { '2026-08-01': { aiTask: false, manualTask: false } };
    const after = { '2026-08-01': { aiTask: true, manualTask: false } };
    const recorded = recordAiActionVersion(
      { ...emptyAppState(), taskLogs: after },
      { action: 'bulkMarkDone', entityType: 'taskLogs', entityId: '2026-08-01:aiTask', summary: 'mark AI task done', permissions: ['bulk-edit'], confirmed: true },
      before,
      after,
      new Date('2026-08-01T10:00:00Z'),
    );
    const withConcurrentWrite = {
      ...recorded,
      taskLogs: { '2026-08-01': { aiTask: true, manualTask: true } },
    };

    const undone = undoLastAiAction(withConcurrentWrite);
    expect(undone.taskLogs).toEqual({ '2026-08-01': { aiTask: false, manualTask: true } });
  });

  it('does not let redo overwrite a newer task-log completion', () => {
    const before = { '2026-08-01': { aiTask: false, manualTask: false } };
    const after = { '2026-08-01': { aiTask: true, manualTask: false } };
    const recorded = recordAiActionVersion(
      { ...emptyAppState(), taskLogs: before },
      { action: 'bulkMarkDone', entityType: 'taskLogs', entityId: '2026-08-01:aiTask', summary: 'mark AI task done', permissions: ['bulk-edit'], confirmed: true },
      before,
      after,
      new Date('2026-08-01T10:00:00Z'),
    );
    const undone = undoLastAiAction(recorded);
    const withConcurrentWrite = {
      ...undone,
      taskLogs: { '2026-08-01': { aiTask: false, manualTask: true } },
    };

    const redone = redoLastAiAction(withConcurrentWrite);
    expect(redone.taskLogs).toEqual({ '2026-08-01': { aiTask: true, manualTask: true } });
  });

  it('leaves state and history unchanged when an undo snapshot is malformed', () => {
    const state = {
      ...emptyAppState(),
      taskLogs: { '2026-08-01': { aiTask: true } },
      aiActionHistory: {
        versions: [{
          id: 'bad-undo',
          timestamp: '2026-08-01T10:00:00.000Z',
          action: 'bulkMarkDone',
          entityType: 'taskLogs',
          entityId: '2026-08-01:aiTask',
          summary: 'malformed undo',
          permissions: ['bulk-edit'] as AiActionVersion['permissions'],
          beforeState: { '2026-08-01': { aiTask: false } },
          afterState: { '2026-08-01': { aiTask: 'not-a-boolean' } },
          changedFields: ['taskLogs'],
          confirmationRequired: true,
          confirmed: true,
          status: 'applied' as const,
        }],
        undone: [],
      },
    };

    const result = undoLastAiAction(state);
    expect(result).toBe(state);
  });

  it('leaves state and history unchanged when a redo snapshot is malformed', () => {
    const state = {
      ...emptyAppState(),
      taskLogs: { '2026-08-01': { aiTask: false } },
      aiActionHistory: {
        versions: [{
          id: 'bad-redo',
          timestamp: '2026-08-01T10:00:00.000Z',
          action: 'bulkMarkDone',
          entityType: 'taskLogs',
          entityId: '2026-08-01:aiTask',
          summary: 'malformed redo',
          permissions: ['bulk-edit'] as AiActionVersion['permissions'],
          beforeState: { '2026-08-01': { aiTask: false } },
          afterState: { '2026-08-01': { aiTask: true } },
          changedFields: ['taskLogs'],
          confirmationRequired: true,
          confirmed: true,
          status: 'undone' as const,
        }],
        undone: [{
          id: 'bad-redo',
          timestamp: '2026-08-01T10:00:00.000Z',
          action: 'bulkMarkDone',
          entityType: 'taskLogs',
          entityId: '2026-08-01:aiTask',
          summary: 'malformed redo',
          permissions: ['bulk-edit'] as AiActionVersion['permissions'],
          beforeState: { '2026-08-01': { aiTask: false } },
          afterState: { '2026-08-01': { aiTask: 1 } },
          changedFields: ['taskLogs'],
          confirmationRequired: true,
          confirmed: true,
          status: 'undone' as const,
        }],
      },
    };

    const result = redoLastAiAction(state);
    expect(result).toBe(state);
  });
});
