import type { AppContainer } from '../../di/container';
import type { AuthSession } from '../../lib/auth';
import { ensureV1Base } from '../../lib/auth';
import type { AppState } from '../../core/domain/state';
import { emptyAppState } from '../../core/domain/state';
import type { ChatSession } from '../../core/domain/chat';

/**
 * Everything needed to restore the app if the wipe sequence fails part-way
 * (N3 rollback source). Snapshotted BEFORE the first destructive step and only
 * AFTER flushing pending writes, so it reflects the durable truth on disk.
 */
export interface DeleteAllSnapshot {
  owner: string | null;
  chatSessions: ChatSession[];
  state: AppState;
  syncSession: AuthSession | null;
}

/**
 * Deletes ALL app data — progress, chat, memory, settings, providers — from
 * local storage AND the server backup, returning the app to its fresh default
 * stage. Preserves the login session and the default (server) AI credentials,
 * so the user stays signed in and the hidden provider keeps working.
 *
 * Order matters:
 *   1. Flush pending writes so the rollback snapshot is durable truth.
 *   2. Detach sync so the resets below never push partial state.
 *   3. Wipe the server backup (best-effort — reset must proceed even offline).
 *   4. Clear chat + reset the whole AppState to emptyAppState().
 *   5. Re-apply server auth so the default AI provider survives the reset.
 *   6. Re-attach WITHOUT pulling — the server backup is gone, so a fresh pull
 *      would resurrect the very data we just wiped.
 *   7. Flush again so the wipe is durable immediately — no 400ms debounce
 *      window in which a crash/close could resurrect the old data.
 *
 * Transactional (N3): every step is snapshotted first; if ANY step throws the
 * snapshot is restored (chat + state + owner + sync session) and the error is
 * rethrown so the UI shows it with the user's data fully intact and retry-safe.
 */
export async function deleteAllData(container: AppContainer, session: AuthSession | null): Promise<void> {
  // 1. Make any in-flight debounced writes durable so the snapshot is the
  //    truth that would actually survive a restart.
  container.store.flush();

  // 2. Snapshot everything we are about to destroy.
  const snapshot: DeleteAllSnapshot = {
    owner: localStorage.getItem('levelup.data-owner'),
    chatSessions: container.chat.listSessions(),
    state: container.store.get(),
    syncSession: container.syncCoordinator.getSession(),
  };

  try {
    container.syncCoordinator.detach();

    if (session) {
      try {
        await container.sync.wipe(session);
      } catch {
        // Wipe is best-effort — the local reset must still happen offline.
      }
    }

    container.chat.replaceStore([]);
    container.store.save(emptyAppState());

    // The wiped store now belongs to whoever stays signed in (or guest), so a
    // later switch to a different account still triggers account isolation.
    localStorage.setItem('levelup.data-owner', session?.username ?? 'guest');

    if (session) {
      container.providerSettings.configureServerAuth(ensureV1Base(session.serverUrl), session.apiKey);
      container.syncCoordinator.attach(session, { skipInitialSync: true });
    }

    // 7. Durable commit — the debounced state write must not be the thing that
    //    decides whether the wipe survives an app close/restart.
    container.store.flush();
  } catch (err) {
    rollbackDelete(container, snapshot);
    throw err;
  }
}

/**
 * Restores the pre-wipe snapshot. Best-effort — it must never mask the
 * original error. Sync is re-attached WITHOUT skipInitialSync so the (possibly
 * already-wiped) server backup gets re-seeded from the restored local data.
 */
function rollbackDelete(container: AppContainer, snapshot: DeleteAllSnapshot): void {
  try {
    container.chat.replaceStore(snapshot.chatSessions);
    container.store.save(snapshot.state);
    container.store.flush();
    if (snapshot.owner !== null) localStorage.setItem('levelup.data-owner', snapshot.owner);
    if (snapshot.syncSession) {
      container.syncCoordinator.attach(snapshot.syncSession);
    }
  } catch {
    // Rollback is best-effort — the original error is the one the user sees.
  }
}
