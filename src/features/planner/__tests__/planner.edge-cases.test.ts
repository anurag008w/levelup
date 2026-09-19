import { describe, expect, it } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { AppState } from '../../../core/domain/state';
import type { StateStore } from '../../../core/ports/repositories';
import { PlannerService } from '../planner.service';

function makeStore(state: AppState): StateStore {
  return {
    get: () => state,
    save: (next: AppState) => {
      state = next;
    },
  };
}

describe('PlannerService edge cases', () => {
  it('returns false and does not rewrite state when the item id is stale or missing', () => {
    const state = emptyAppState();
    state.subjectPlanners = [
      {
        id: 'planner-1',
        kind: 'subject',
        subject: 'Physics',
        title: 'Class 11',
        source: 'paste',
        items: [
          { id: 'item-1', title: 'Kinematics', type: 'chapter', done: false },
        ],
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
      },
    ];
    const store = makeStore(state);
    const planner = new PlannerService(store);
    const before = store.get();

    expect(planner.toggleItem('planner-1', 'stale-item', true)).toBe(false);
    expect(store.get()).toBe(before);
    expect(store.get().subjectPlanners[0].items[0].done).toBe(false);
  });
});
