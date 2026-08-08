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
// The unlock flag is stored per-username so switching accounts on the same
// device cannot inherit another user's panel access.

import { loginToServer } from './auth';

const ADMIN_STORAGE_KEY = 'levelup.admin.unlocked';

export interface AdminVerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Whether a logged-in session is a server-side super admin (no dialog needed).
 * NOTE: role alone (e.g. role='admin') is NOT enough — the server only flags
 * is_super_admin for accounts listed in its ADMIN_USERS config.
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

/** Whether the admin panel was unlocked for this user (persisted on-device). */
export function isAdminUnlocked(username: string | null): boolean {
  try {
    return localStorage.getItem(storageKey(username)) === '1';
  } catch {
    return false;
  }
}

/** Persists/lifts the per-user unlocked flag on-device. */
export function setAdminUnlocked(username: string | null, unlocked: boolean): void {
  try {
    if (unlocked) localStorage.setItem(storageKey(username), '1');
    else localStorage.removeItem(storageKey(username));
  } catch {
    // storage unavailable — session persists until reload
  }
}

function storageKey(username: string | null): string {
  return username ? `${ADMIN_STORAGE_KEY}.${username}` : ADMIN_STORAGE_KEY;
}
