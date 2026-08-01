import { useState } from 'react';
import { Lock, LogIn, ShieldAlert, X } from 'lucide-react';

/**
 * Minimal on-device admin gate. Credentials are checked locally — this is a
 * personal control-panel unlock, not an auth boundary.
 */
export default function AdminLogin({
  onLogin,
  onClose,
}: {
  onLogin: (username: string, password: string) => boolean;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function submit() {
    if (!onLogin(username, password)) {
      setError('Galat username ya password.');
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Admin login" className="gradient-border w-full max-w-sm rounded-[1.25rem] p-px">
        <div className="rounded-[calc(1.25rem-1px)] bg-panel p-5">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(107,138,253,0.15)', color: 'var(--color-peak)' }}>
                <Lock size={17} />
              </div>
              <div>
                <p className="font-display text-[15px] font-bold">Admin Login</p>
                <p className="text-xs text-muted">90-day control panel</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="icon-btn">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="admin-user">
                Username
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
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="admin-pass">
                Password
              </label>
              <input
                id="admin-pass"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                autoComplete="current-password"
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

            <button type="button" className="btn btn-primary w-full" onClick={submit} disabled={!username.trim() || !password}>
              <LogIn size={15} /> Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
