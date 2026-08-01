const ADMIN_USERNAME = 'anurag008_w';
const ADMIN_PASSWORD = 'admin2008';
const ADMIN_STORAGE_KEY = 'levelup.admin.unlocked';

/** Verifies the admin credentials. Local, personal gate — not a security boundary. */
export function verifyAdmin(username: string, password: string): boolean {
  return username.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase() && password === ADMIN_PASSWORD;
}

/** Whether the admin panel was unlocked earlier (persisted on-device). */
export function isAdminUnlocked(): boolean {
  try {
    return localStorage.getItem(ADMIN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persists/lifts the unlocked flag on-device. */
export function setAdminUnlocked(unlocked: boolean): void {
  try {
    if (unlocked) localStorage.setItem(ADMIN_STORAGE_KEY, '1');
    else localStorage.removeItem(ADMIN_STORAGE_KEY);
  } catch {
    // storage unavailable — session persists until reload
  }
}
