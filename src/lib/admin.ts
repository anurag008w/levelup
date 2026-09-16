// Admin panel gate — server-backed, no hardcoded client credentials.
//
// Who can open the panel:
//  1. Super admins (server says `is_super_admin` — the ADMIN_USERS list on the
//     SmartRotator gateway) get in WITHOUT a dialog: the shield button unlocks
//     straight away.
//  2. Everyone else can try credentials through the dialog. Those are verified
//     against the server's real /auth/login — the panel only unlocks if that
//     account is itself a super admin. Nothing is hardcoded on the client.
//
// The unlock marker is stored per username + login timestamp so switching or
// re-authenticating accounts on the same device cannot inherit another session's
// panel access.

import { loginToServer } from './auth';

const ADMIN_STORAGE_KEY = 'levelup.admin.unlocked';

export interface AdminVerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Whether a logged-in session is a server-side super admin (no dialog needed).
 * NOTE: role alone (e.g. role='admin') is NOT enough — the server only flags
 * isSuperAdmin for accounts listed in its ADMIN_USERS config.
 */
export function canAutoUnlockSession(session: { isSuperAdmin?: boolean; role?: string } | null | undefined): boolean {
  return session?.isSuperAdmin === true;
}

/**
 * Verifies credentials against the server and unlocks only when the account is
 * a super admin. Never touches localStorage — the caller persists the flag.
 */
export async function verifyAdminLogin(username: string, password: string): Promise<AdminVerifyResult> {
  const clean = username.trim();
  if (!clean || !password) return { ok: false, error: 'Username aur password dono bharo.' };

  try {
    const session = await loginToServer(clean, password);
    if (session.isSuperAdmin) return { ok: true };
    return {
      ok: false,
      error: 'Ye account super admin nahi hai — admin panel sirf server ke ADMIN_USERS wale accounts ke liye khulta hai.',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Server se verify nahi hua.' };
  }
}

/** Whether the admin panel was unlocked for this exact login session. */
export function isAdminUnlocked(username: string | null, loggedInAt?: string | null): boolean {
  if (!username || !loggedInAt) return false;
  try {
    return localStorage.getItem(storageKey(username, loggedInAt)) === '1';
  } catch {
    return false;
  }
}

/** Persists/lifts the unlocked flag for this exact login session. */
export function setAdminUnlocked(username: string | null, loggedInAt: string | null, unlocked: boolean): void {
  if (!username || !loggedInAt) return;
  try {
    if (unlocked) localStorage.setItem(storageKey(username, loggedInAt), '1');
    else localStorage.removeItem(storageKey(username, loggedInAt));
  } catch {
    // storage unavailable — session persists until reload
  }
}

function storageKey(username: string, loggedInAt: string): string {
  return `${ADMIN_STORAGE_KEY}.${username}.${loggedInAt}`;
}
