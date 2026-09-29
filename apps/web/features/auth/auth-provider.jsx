'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createAuthSession } from '../../lib/auth/session';

const AuthContext = createContext(null);
export function AuthProvider({ children, session: supplied }) {
  const queryClient = useQueryClient();
  const [session] = useState(
    () =>
      supplied || createAuthSession({ clearCache: () => queryClient.clear() }),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getServerSnapshot,
  );
  useEffect(() => {
    session.bootstrap();
  }, [session]);
  return (
    <AuthContext.Provider value={{ ...session, ...state }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth requires AuthProvider.');
  return auth;
}
