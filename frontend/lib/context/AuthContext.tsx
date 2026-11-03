'use client';

import React, { createContext, useState, ReactNode, useEffect, useContext, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/utils/supabase/client';
import { Session } from '@supabase/supabase-js';

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
}

interface AuthContextType {
  user: ApiUser | null;
  isLoggedIn: boolean;
  isBuyer: boolean;
  isSeller: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  bootstrapSession: () => Promise<ApiUser | null>;
  logout: () => void;
  // login is no longer explicitly called because Supabase handles the session injection
  login: (token: string, userData: ApiUser) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const supabaseRef = useRef(createClient());
  const bootstrapPromiseRef = useRef<Promise<ApiUser | null> | null>(null);
  const bootstrappedTokenRef = useRef<string | null>(null);
  const router = useRouter();

  // Server is the source of truth for admin status. isAdmin is for rendering only;
  // admin routes/endpoints are still enforced by the backend on every request.
  const refreshAdminStatus = async (accessToken?: string) => {
    if (!accessToken || !API_URL) {
      setIsAdmin(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/admin/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setIsAdmin(res.ok); // 200 = admin, 403 = not
    } catch {
      // Network error / backend unreachable: fetch throws rather than returning a
      // non-OK status. Fail closed so the context never crashes.
      setIsAdmin(false);
    }
  };

  const fetchBackendUser = async (accessToken: string): Promise<ApiUser | null> => {
    if (!API_URL) {
      throw new Error('Backend API is not configured.');
    }

    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      // Token for a deleted/invalid account (backend rejects zombie JWTs).
      // Sign out to clear the stale cookies so it doesn't retry until expiry.
      await supabaseRef.current.auth.signOut();
      return null;
    }
    if (!res.ok) {
      throw new Error('Failed to finish account setup.');
    }
    return (await res.json()) as ApiUser;
  };

  const syncAuthenticatedSession = async (
    session: Session,
    options: { force?: boolean } = {},
  ): Promise<ApiUser | null> => {
    const accessToken = session.access_token;
    const sbUser = session.user;

    if (!accessToken || !sbUser) {
      setUser(null);
      setIsAdmin(false);
      return null;
    }

    if (!options.force && bootstrappedTokenRef.current === accessToken && user) {
      await refreshAdminStatus(accessToken);
      return user;
    }

    if (!options.force && bootstrapPromiseRef.current) {
      return bootstrapPromiseRef.current;
    }

    const bootstrapPromise = (async () => {
      const backendUser = await fetchBackendUser(accessToken);
      if (!backendUser) {
        // 401: fetchBackendUser already signed the stale session out.
        setUser(null);
        setIsAdmin(false);
        bootstrappedTokenRef.current = null;
        return null;
      }
      setUser(backendUser);
      bootstrappedTokenRef.current = accessToken;
      await refreshAdminStatus(accessToken);
      return backendUser;
    })();

    bootstrapPromiseRef.current = bootstrapPromise;

    try {
      return await bootstrapPromise;
    } catch (error) {
      setUser(null);
      setIsAdmin(false);
      bootstrappedTokenRef.current = null;
      throw error;
    } finally {
      bootstrapPromiseRef.current = null;
    }
  };

  const syncAuthenticatedSessionRef = useRef(syncAuthenticatedSession);
  useEffect(() => {
    syncAuthenticatedSessionRef.current = syncAuthenticatedSession;
  });

  const bootstrapSession = async (): Promise<ApiUser | null> => {
    const {
      data: { session },
    } = await supabaseRef.current.auth.getSession();

    if (!session) {
      return null;
    }

    return syncAuthenticatedSession(session, { force: true });
  };

  useEffect(() => {
    // Native Supabase Session Hydration
    const loadSession = async () => {
      try {
        const {
          data: { session },
        } = await supabaseRef.current.auth.getSession();

        if (session?.user) {
          await syncAuthenticatedSessionRef.current(session);
          return;
        }

        setUser(null);
        setIsAdmin(false);
      } catch (error) {
        console.error('Failed to load auth session', error);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadSession();

    // Listen for login/logout/token-refresh natively
    const {
      data: { subscription },
    } = supabaseRef.current.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // Keep isLoading true until the backend user is resolved; clearing it
        // while user is still null makes auth gates flash their signed-out state.
        // The catch keeps a backend failure from surfacing as an unhandled
        // rejection (runtime overlay); state was already reset by the thrower.
        void syncAuthenticatedSessionRef
          .current(session)
          .catch((error) => console.error('Failed to sync auth session', error))
          .finally(() => setIsLoading(false));
      } else {
        setUser(null);
        setIsAdmin(false);
        bootstrappedTokenRef.current = null;
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = (token: string, userData: ApiUser) => {
    // Kept for backward compatibility with older components if they manually invoke this,
    // though Supabase manages it now natively.
    setUser(userData);
  };

  const logout = async () => {
    await supabaseRef.current.auth.signOut();
    setUser(null);
    setIsAdmin(false);
    router.push('/');
  };

  const isLoggedIn = user !== null;
  const isBuyer = user?.role === 'buyer';
  const isSeller = user?.role === 'seller';

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoggedIn,
        isBuyer,
        isSeller,
        isAdmin,
        isLoading,
        bootstrapSession,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
