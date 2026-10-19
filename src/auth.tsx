import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError, errorMessage, isCancelled } from './api';
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
  acceptSession: (session: Session) => void;
  forgetSession: () => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [api] = useState(() => new ApiClient());
  const [state, setState] = useState<AuthState>({ status: 'checking' });
  const revision = useRef(0);
  const acceptSession = useCallback(
    (session: Session) => {
      revision.current++;
      api.setSession(session);
      setState({ status: 'authenticated', session });
    },
    [api],
  );
  const expire = useCallback(() => {
    revision.current++;
    api.clearSession();
    setState({ status: 'guest' });
  }, [api]);
  const check = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++revision.current;
      setState({ status: 'checking' });
      try {
        const session = await api.session(signal);
        if (signal?.aborted || current !== revision.current) return;
        acceptSession(session);
      } catch (error) {
        if (signal?.aborted || current !== revision.current) return;
        if (isCancelled(error)) return;
        if (error instanceof ApiError && error.status === 401) expire();
        else setState({ status: 'error', message: errorMessage(error) });
      }
    },
    [api, expire, acceptSession],
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
    const current = ++revision.current;
    const session = await api.login(id, password);
    if (current === revision.current) acceptSession(session);
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
    <AuthContext.Provider
      value={{ state, api, check, login, logout, acceptSession, forgetSession: expire }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider is required');
  return auth;
}
