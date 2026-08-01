import { describe, expect, it } from 'vitest';
import { emptyAppState } from '../state';
import { AiActionRegistry, AiPermissionEngine, executeAiAction, recordAiActionVersion, undoLastAiAction, redoLastAiAction, createAiActionPreview } from '../ai-actions';

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
});
