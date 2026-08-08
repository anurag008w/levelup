import { useState } from 'react';
import { Lock, LogIn, ShieldAlert, X } from 'lucide-react';
import type { AdminVerifyResult } from '../lib/admin';

/**
 * Admin gate for non-super-admin sessions. Credentials are verified against
 * the server (/auth/login) — the panel unlocks only for server super admins.
 * Super admins skip this dialog entirely (see TodayScreen's auto-unlock).
 */
export default function AdminLogin({
  onLogin,
  onClose,
}: {
  onLogin: (username: string, password: string) => Promise<AdminVerifyResult>;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  async function submit() {
    if (loggingIn) return;
    setLoggingIn(true);
    setError('');
    const result = await onLogin(username, password);
    setLoggingIn(false);
    if (!result.ok) {
      setError(result.error ?? 'Galat username ya password.');
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Admin login" className="gradient-border w-full max-w-sm rounded-2xl p-px">
        <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-5">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(239,233,223,0.15)', color: 'var(--color-peak)' }}>
                <Lock size={17} />
              </div>
              <div>
                <p className="font-display text-[15px] font-bold">Admin Login</p>
                <p className="text-xs text-muted">90-day control panel — super admin accounts only</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="icon-btn" disabled={loggingIn}>
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="admin-user">
                Server username
              </label>
              <input
                id="admin-user"
                className="field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                disabled={loggingIn}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="admin-pass">
                Server password
              </label>
              <input
                id="admin-pass"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                autoComplete="current-password"
                disabled={loggingIn}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
            </div>

            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                <ShieldAlert size={13} /> {error}
              </p>
            )}

            <button type="button" className="btn btn-primary w-full" onClick={submit} disabled={!username.trim() || !password || loggingIn}>
              {loggingIn ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Verifying…
                </span>
              ) : (
                <>
                  <LogIn size={15} /> Login
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
