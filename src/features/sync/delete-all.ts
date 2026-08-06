import type { AppContainer } from '../../di/container';
import type { AuthSession } from '../../lib/auth';
import { ensureV1Base } from '../../lib/auth';
import { emptyAppState } from '../../core/domain/state';

/**
 * Deletes ALL app data — progress, chat, memory, settings, providers — from
 * local storage AND the server backup, returning the app to its fresh default
 * stage. Preserves the login session and the default (server) AI credentials,
 * so the user stays signed in and the hidden provider keeps working.
 *
 * Order matters:
 *   1. Detach sync so the resets below never push partial state.
 *   2. Wipe the server backup (best-effort — reset must proceed even offline).
 *   3. Clear chat + reset the whole AppState to emptyAppState().
 *   4. Re-apply server auth so the default AI provider survives the reset.
 *   5. Re-attach WITHOUT pulling — the server backup is gone, so a fresh pull
 *      would resurrect the very data we just wiped.
 */
export async function deleteAllData(container: AppContainer, session: AuthSession | null): Promise<void> {
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
}
