import { describe, expect, it } from 'vitest';
import { emptyAppState, type AppState } from '../../../core/domain/state';
import type { StateStore } from '../../../core/ports/repositories';
import { applyBackup, buildBackupPayload } from '../backup.service';

class FakeStore implements StateStore {
  current: AppState = emptyAppState();
  saveCount = 0;

  get(): AppState {
    return this.current;
  }

  save(state: AppState): void {
    this.saveCount += 1;
    this.current = state;
  }
}

describe('scoped task backup merge regression', () => {
  it('preserves local task data while importing backup-only task data', () => {
    const store = new FakeStore();
    const local = emptyAppState();
    local.taskLogs['2026-09-15'] = { localTask: true } as AppState['taskLogs'][string];
    local.planCache['2026-09-15'] = {} as AppState['planCache'][string];
    local.masteryPlacement.localTask = { bucket: 'completed' };
    store.current = local;

    const incoming = emptyAppState();
    incoming.taskLogs['2026-09-16'] = { backupTask: true } as AppState['taskLogs'][string];
    incoming.planCache['2026-09-16'] = {} as AppState['planCache'][string];
    incoming.masteryPlacement.backupTask = { bucket: 'scheduled', day: 16 };

    const payload = buildBackupPayload(incoming, null, 'tasks');
    applyBackup(payload, { store });

    expect(store.saveCount).toBe(1);
    expect(store.current.taskLogs['2026-09-15']?.localTask).toBe(true);
    expect(store.current.taskLogs['2026-09-16']?.backupTask).toBe(true);
    expect(store.current.planCache['2026-09-15']).toBeDefined();
    expect(store.current.planCache['2026-09-16']).toBeDefined();
    expect(store.current.masteryPlacement.localTask).toEqual({ bucket: 'completed' });
    expect(store.current.masteryPlacement.backupTask).toEqual({ bucket: 'scheduled', day: 16 });
  });
});
