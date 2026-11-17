import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { ensureUserProfile } from '@/services/tripService';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  authLoading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<User | null>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);

        if (currentUser) {
          void ensureUserProfile(currentUser).catch((error) => {
            console.error('Failed to sync user profile:', error);
          });
        }
      },
      (error) => {
        setAuthError(error.message || 'Authentication state check failed.');
        setAuthReady(true);
      },
    );

    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      await ensureUserProfile(result.user);
      return result.user;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to sign in with Google.';
      setAuthError(message);
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      await signOut(auth);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to sign out.';
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      authReady,
      authLoading,
      authError,
      signInWithGoogle,
      logout,
      getIdToken,
      clearAuthError,
    }),
    [
      user,
      authReady,
      authLoading,
      authError,
      signInWithGoogle,
      logout,
      getIdToken,
      clearAuthError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}
