'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getClientAuth, getClientDb } from '@/lib/firebase/client';
import type { AppUser, UserRole } from '@/types';

interface AuthState {
  readonly user: User | null;
  readonly profile: AppUser | null;
  readonly role: UserRole | null;
  readonly loading: boolean;
}

interface AuthContextValue extends AuthState {
  readonly refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    role: null,
    loading: true,
  });

  async function fetchProfile(user: User): Promise<void> {
    try {
      // First check custom claims from token
      const tokenResult = await user.getIdTokenResult();
      const claimsRole = tokenResult.claims['role'] as UserRole | undefined;

      // Then fetch full profile from Firestore
      const profileDoc = await getDoc(doc(getClientDb(), 'users', user.uid));
      if (profileDoc.exists()) {
        const data = profileDoc.data();
        const profile: AppUser = {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? data['displayName'] ?? '',
          role: claimsRole ?? data['role'] ?? 'viewer',
          stationId: data['stationId'] ?? '',
          status: data['status'] ?? 'active',
          createdAt: data['createdAt']?.toDate() ?? new Date(),
          updatedAt: data['updatedAt']?.toDate() ?? new Date(),
        };
        setState({
          user,
          profile,
          role: profile.role,
          loading: false,
        });
      } else {
        // User exists in Auth but no Firestore profile
        setState({
          user,
          profile: null,
          role: claimsRole ?? null,
          loading: false,
        });
      }
    } catch {
      setState({ user, profile: null, role: null, loading: false });
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getClientAuth(), (user) => {
      if (user) {
        void fetchProfile(user);
      } else {
        setState({ user: null, profile: null, role: null, loading: false });
      }
    });
    return unsubscribe;
  }, []);

  async function refreshProfile(): Promise<void> {
    if (state.user) {
      // Force token refresh to pick up new claims
      await state.user.getIdToken(true);
      await fetchProfile(state.user);
    }
  }

  return (
    <AuthContext.Provider value={{ ...state, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
