import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { ApiError } from '../lib/api.ts';

const DEMO_ACCOUNTS = [
  { email: 'admin@acme.test', password: 'AcmeAdmin!2026', label: 'Acme admin' },
  { email: 'member@acme.test', password: 'AcmeMember!2026', label: 'Acme member' },
  { email: 'admin@beta.test', password: 'BetaAdmin!2026', label: 'Beta admin' },
];

export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · SaaS Demand Radar';
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    }
  }, [status, navigate, location.state]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.status === 429 ? `${caught.message}` : caught.message);
      } else {
        setError('Unable to reach the API. Is it running on port 4174?');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__brand">
          <span aria-hidden="true">◎</span>
          <div>
            <h1 id="login-heading">SaaS Demand Radar</h1>
            <p>Find the software people are publicly asking for.</p>
          </div>
        </div>

        <form
          className="form"
          data-testid="login-form"
          aria-labelledby="login-heading"
          onSubmit={submit}
          aria-busy={busy}
          noValidate
        >
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby={error ? 'login-error' : undefined}
              placeholder="admin@acme.test"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••"
            />
          </div>

          {error ? (
            <p className="form__error" id="login-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-card__hint">
          <h2>Demo accounts</h2>
          <ul>
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  className="btn btn--link"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                  }}
                >
                  {account.label}: {account.email}
                </button>
              </li>
            ))}
          </ul>
          <p>
            Sessions use an HTTP-only cookie, so the browser never exposes the session token to
            JavaScript.
          </p>
        </div>
      </div>
    </div>
  );
}
