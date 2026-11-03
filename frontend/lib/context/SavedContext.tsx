'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { redirectToLogin } from '@/lib/utils/authRedirect';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface SavedContextType {
  savedListings: string[];
  isSaved: (id: string) => boolean;
  toggleSaved: (id: string) => void;
  isLoading: boolean;
}

const SavedContext = createContext<SavedContextType>({
  savedListings: [],
  isSaved: () => false,
  toggleSaved: () => {},
  isLoading: true,
});

export function SavedProvider({ children }: { children: React.ReactNode }) {
  const [savedListings, setSavedListings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isLoggedIn } = useAuth();

  // Fetch user's saved listings from the backend
  useEffect(() => {
    const fetchSaved = async () => {
      if (!isLoggedIn) {
        setSavedListings([]);
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/listings/favorites/mine`, {
          headers: await getAuthHeaders(),
        });

        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setSavedListings(data.map((listing: any) => listing.id));
        }
      } catch (err) {
        console.error('Failed to fetch saved listings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSaved();
  }, [isLoggedIn, user?.id]);

  const isSaved = (id: string) => savedListings.includes(id);

  const toggleSaved = useCallback(
    async (id: string) => {
      if (!isLoggedIn) return;

      const alreadySaved = savedListings.includes(id);

      // Optimistic UI update
      setSavedListings((prev) =>
        alreadySaved ? prev.filter((item) => item !== id) : [...prev, id],
      );

      try {
        const method = alreadySaved ? 'DELETE' : 'POST';
        const res = await fetch(`${API_URL}/listings/${id}/favorite`, {
          method,
          headers: await getAuthHeaders(),
        });

        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) {
          // Revert optimistic update on failure
          setSavedListings((prev) =>
            alreadySaved ? [...prev, id] : prev.filter((item) => item !== id),
          );
        }
      } catch (err) {
        console.error('Failed to toggle saved:', err);
        // Revert on network error
        setSavedListings((prev) =>
          alreadySaved ? [...prev, id] : prev.filter((item) => item !== id),
        );
      }
    },
    [isLoggedIn, savedListings],
  );

  return (
    <SavedContext.Provider value={{ savedListings, isSaved, toggleSaved, isLoading }}>
      {children}
    </SavedContext.Provider>
  );
}

export const useSaved = () => useContext(SavedContext);
