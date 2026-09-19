import { describe, expect, it } from 'vitest';
import { emptyAppState } from '../state';
import {
  executeAiAction,
  redoLastAiAction,
  undoLastAiAction,
  type AiRegisteredAction,
} from '../ai-actions';

describe('AI day-mode snapshot normalization', () => {
  const action: AiRegisteredAction = {
    id: 'setDayMode',
    label: 'Set day mode',
    description: 'Test day-mode snapshot application',
    entityType: 'dayModes',
    permissions: ['edit'],
    confirmationRequired: false,
  };

  it('deduplicates persisted rest/test day numbers when applying an action snapshot', () => {
    const state = emptyAppState();
    const result = executeAiAction({
      state,
      action,
      entityId: 'day-5',
      summary: 'set day mode',
      beforeState: { restDays: [], testDays: [] },
      afterState: { restDays: [5, 5, 12, 5], testDays: [20, 20] },
      confirmed: true,
      now: new Date('2026-09-16T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.state.restDays).toEqual([5, 12]);
    expect(result.state.testDays).toEqual([20]);
  });

  it('keeps undo/redo day-mode snapshots canonical instead of restoring duplicates', () => {
    const state = emptyAppState();
    const result = executeAiAction({
      state,
      action,
      entityId: 'day-5',
      summary: 'set day mode',
      beforeState: { restDays: [], testDays: [] },
      afterState: { restDays: [5, 5], testDays: [9, 9] },
      confirmed: true,
      now: new Date('2026-09-16T00:00:00.000Z'),
    });

    const undone = undoLastAiAction(result.state);
    expect(undone.restDays).toEqual([]);
    expect(undone.testDays).toEqual([]);

    const redone = redoLastAiAction(undone);
    expect(redone.restDays).toEqual([5]);
    expect(redone.testDays).toEqual([9]);
  });
});
