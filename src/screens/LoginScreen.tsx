import { useState } from 'react';
import { KeyRound, Loader2, LogIn, Sparkles, User, UserPlus } from 'lucide-react';
import type { AuthSession } from '../lib/auth';
import { loginToServer, registerOnServer, friendlyAuthError } from '../lib/auth';
import { haptic } from '../lib/haptics';

interface Props {
  onLoggedIn: (session: AuthSession) => void;
}

/**
 * Login / Register gate shown at app start. One form, smart flow:
 * "user exists → login, otherwise → register". A failed login surfaces a
 * one-tap "Register karo" action; a failed register offers login instead.
 *
 * The server URL is intentionally NOT shown or editable — it is baked into the
 * build via VITE_DEFAULT_AI_BASE_URL (fallback: the public gateway) and stays
 * hidden from users.
 */
export default function LoginScreen({ onLoggedIn }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-l/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-light/10 blur-3xl" aria-hidden="true" />

      <form onSubmit={submit} className="card relative w-full max-w-sm p-6" noValidate>
        {/* Brand */}
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-l/10 text-l">
            <Sparkles size={20} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold leading-tight">LevelUp</p>
            <p className="text-xs text-muted">Apne server se connect karo</p>
          </div>
        </div>

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
          <p className="mt-3.5 rounded-xl px-3 py-2 text-xs leading-relaxed text-danger" style={{ backgroundColor: 'rgba(201,87,87,0.12)' }}>
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
      </form>
    </div>
  );
}
