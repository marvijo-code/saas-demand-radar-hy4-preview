import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AUTH_EXPIRED_EVENT, ApiError, api, type AuthSession } from '../lib/api.ts';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  session: AuthSession | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.me();
      setSession(next);
      setStatus('authenticated');
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSession(null);
        setStatus('anonymous');
      } else {
        setStatus('anonymous');
        setError(caught instanceof Error ? caught.message : 'Unable to reach the API.');
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const expireSession = () => {
      setSession(null);
      setStatus('anonymous');
      setError(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const next = await api.login(email, password);
      setSession(next);
      setStatus('authenticated');
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, session, error, signIn, signOut, refresh }),
    [status, session, error, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
