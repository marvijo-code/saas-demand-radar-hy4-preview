import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { NeedsPage } from './pages/NeedsPage.tsx';
import { NeedDetailPage } from './pages/NeedDetailPage.tsx';
import { SourcesPage } from './pages/SourcesPage.tsx';
import { FeedbackPage } from './pages/FeedbackPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AuditPage } from './pages/AuditPage.tsx';
import { classNames } from './lib/format.tsx';

const NAV = [
  { to: '/', label: 'Overview', testId: 'nav-overview' },
  { to: '/needs', label: 'Needs', testId: 'nav-needs' },
  { to: '/sources', label: 'Source runs', testId: 'nav-sources' },
  { to: '/feedback', label: 'Learning', testId: 'nav-feedback' },
  { to: '/settings', label: 'Team', testId: 'nav-settings' },
  { to: '/audit', label: 'Audit', testId: 'nav-audit' },
];

export function App() {
  const { status, session, signOut } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (status === 'authenticated') return;
    document.title = 'Sign in · SaaS Demand Radar';
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="boot-screen" data-testid="app-shell" role="status" aria-live="polite">
        <div className="boot-screen__card">
          <span className="spinner" aria-hidden="true" />
          <p>Loading SaaS Demand Radar…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div data-testid="app-shell">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true">
            ◎
          </span>
          <div>
            <p className="app-header__product">SaaS Demand Radar</p>
            <p className="app-header__workspace">{session.workspace?.name ?? 'Workspace'}</p>
          </div>
        </div>

        <nav className="app-nav" aria-label="Main navigation">
          <ul>
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  data-testid={item.testId}
                  className={({ isActive }) => classNames('app-nav__link', isActive && 'is-active')}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="app-header__user">
          <div className="app-header__identity">
            <p className="app-header__name">{session.user.name}</p>
            <p className="app-header__role">
              {session.user.role === 'admin' ? 'Admin' : 'Member'} · {session.user.email}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main id="main-content" className="app-main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/needs" element={<NeedsPage />} />
          <Route path="/needs/:id" element={<NeedDetailPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <p>
          Evidence is public source text. Scores are computed from persisted feedback and the
          active ranking model.
        </p>
      </footer>
    </div>
  );
}
