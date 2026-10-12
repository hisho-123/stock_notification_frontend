import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiClient, ApiError, errorMessage } from './api';
import type { Session } from './types';

type AuthState =
  | { status: 'checking' | 'guest' }
  | { status: 'error'; message: string }
  | { status: 'authenticated'; session: Session };
interface AuthContextValue {
  state: AuthState;
  api: ApiClient;
  check: (signal?: AbortSignal) => Promise<void>;
  login: (id: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [api] = useState(() => new ApiClient());
  const [state, setState] = useState<AuthState>({ status: 'checking' });
  const expire = useCallback(() => {
    api.clearSession();
    setState({ status: 'guest' });
  }, [api]);
  const check = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'checking' });
      try {
        const session = await api.session(signal);
        if (signal?.aborted) return;
        api.setSession(session);
        setState({ status: 'authenticated', session });
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ApiError && error.status === 401) expire();
        else setState({ status: 'error', message: errorMessage(error) });
      }
    },
    [api, expire],
  );
  useEffect(() => {
    api.onUnauthorized = expire;
    const controller = new AbortController();
    void check(controller.signal);
    return () => {
      controller.abort();
      api.onUnauthorized = () => {};
    };
  }, [api, check, expire]);
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const timeout = window.setTimeout(
      expire,
      Math.max(0, Date.parse(state.session.expires_at) - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [state, expire]);

  async function login(id: string, password: string) {
    const session = await api.login(id, password);
    api.setSession(session);
    setState({ status: 'authenticated', session });
  }
  async function logout() {
    try {
      await api.logout();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    expire();
  }
  return (
    <AuthContext.Provider value={{ state, api, check, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider is required');
  return auth;
}
