import { useState } from 'react';
import { KeyRound, Loader2, LogIn, User, UserPlus, X } from 'lucide-react';
import type { AuthSession } from '../lib/auth';
import { loginToServer, registerOnServer, friendlyAuthError } from '../lib/auth';
import { haptic } from '../lib/haptics';

interface Props {
  onLoggedIn: (session: AuthSession) => void;
  onSkip?: () => void;
}

/**
 * Login / Register gate shown at app start. One form, smart flow:
 * "user exists → login, otherwise → register". A failed login surfaces a
 * one-tap "Register karo" action; a failed register offers login instead.
 *
 * "Skip" enters offline guest mode — the app runs on local data only, no
 * server model and no sync. A later login enables both.
 *
 * The server URL is intentionally NOT shown or editable — it is baked into the
 * build via VITE_DEFAULT_AI_BASE_URL (fallback: the public gateway) and stays
 * hidden from users.
 */
export default function LoginScreen({ onLoggedIn, onSkip }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skipEnabled = Boolean(onSkip);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const user = username.trim();
    if (user.length < 3) {
      setError('Username kam se kam 3 characters ka ho.');
      return;
    }
    if (password.length < 6) {
      setError('Password kam se kam 6 characters ka ho.');
      return;
    }
    setBusy(true);
    setError(null);
    haptic(6);
    try {
      const session = registerMode
        ? await registerOnServer(user, password)
        : await loginToServer(user, password);
      onLoggedIn(session);
    } catch (err) {
      setError(friendlyAuthError(err).message);
      // Smart flow: login fail = user nahi mila → register offer karo; register
      // fail = user pehle se hai → login offer karo.
      setRegisterMode((mode) => !mode);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: boolean) {
    haptic();
    setError(null);
    setRegisterMode(next);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10 text-text">
      {/* Blood-red ambience — matches the splash/icon glow */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blood/25 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-l/15 blur-3xl" aria-hidden="true" />
      {/* Giant ghost "L" watermark */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none font-display text-[26rem] font-bold leading-none text-l/[0.045]"
      >
        L
      </span>
      {/* Hairline rule echoing the hero gradient border */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-l/50 to-transparent" aria-hidden="true" />

      <form onSubmit={submit} className="relative w-full max-w-sm" noValidate>
        {/* Brand mark — "L" medallion with blood glow */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="glow-l relative flex h-16 w-16 items-center justify-center rounded-2xl border border-l/40 bg-gradient-to-b from-panel-raised to-bg">
            <span className="font-display text-4xl font-bold leading-none text-light drop-shadow-[0_0_14px_rgba(216,31,20,0.55)]">
              L
            </span>
            <span className="absolute -bottom-1.5 h-1 w-8 rounded-full bg-l shadow-[0_0_10px_rgba(216,31,20,0.8)]" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight" aria-label="LevelUp">
            LEVEL<span className="text-l">UP</span>
          </h1>
          <p className="mt-1 text-xs tracking-wide text-muted">Premium study discipline — {registerMode ? 'apni identity banao' : 'apni identity wapas lo'}</p>
        </div>

        <div className="gradient-border rounded-2xl p-px">
          <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel/95 p-5">
            {/* Login / Register tabs — same page, smart flow */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg/60 p-1">
              <button
                type="button"
                onClick={() => switchMode(false)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${!registerMode ? 'bg-panel-raised text-text' : 'text-muted'}`}
                aria-pressed={!registerMode}
              >
                <LogIn size={13} /> Login
              </button>
              <button
                type="button"
                onClick={() => switchMode(true)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${registerMode ? 'bg-panel-raised text-text' : 'text-muted'}`}
                aria-pressed={registerMode}
              >
                <UserPlus size={13} /> Register
              </button>
            </div>

            <div className="space-y-3.5">
              <label className="block">
                <span className="field-label">Username</span>
                <div className="relative">
                  <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
                  <input
                    className="field pl-9"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="aapka username"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                </div>
              </label>

              <label className="block">
                <span className="field-label">Password</span>
                <div className="relative">
                  <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
                  <input
                    className="field pl-9"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="min 6 characters"
                    autoComplete={registerMode ? 'new-password' : 'current-password'}
                    disabled={busy}
                  />
                </div>
              </label>
            </div>

            {error && (
              <p className="mt-3.5 rounded-xl px-3 py-2 text-xs leading-relaxed text-danger" style={{ backgroundColor: 'rgba(163,19,19,0.14)' }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn btn-primary mt-5 min-h-11 w-full gap-2">
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> {registerMode ? 'Account bana rahe…' : 'Login ho raha…'}
                </>
              ) : registerMode ? (
                <>
                  <UserPlus size={16} /> Account banao
                </>
              ) : (
                <>
                  <LogIn size={16} /> Login / Continue
                </>
              )}
            </button>

            {!registerMode && (
              <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-dim">
                No account? Register on the same page — one tap.
              </p>
            )}

            <div className="mt-5 border-t border-border pt-4">
              <button
                type="button"
                disabled={!skipEnabled}
                onClick={() => {
                  haptic();
                  onSkip?.();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={13} /> Skip — offline mode me chalein
              </button>
              <p className="mt-1.5 text-center text-[11px] leading-relaxed text-muted-dim">
                Login kiye bina app use karo. Data sirf is device pe — AI server aur backup band.
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
