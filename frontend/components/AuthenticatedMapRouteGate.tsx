'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

import { useAuth } from '@/lib/hooks/useAuth';

interface AuthenticatedMapRouteGateProps {
  children: ReactNode;
}

// mapbox-gl needs the window object, so the public preview map is client-only.
const HeroLotPreview = dynamic(() => import('@/components/HeroLotPreview'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-surface-50">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    </div>
  ),
});

export function AuthenticatedMapRouteGate({ children }: AuthenticatedMapRouteGateProps) {
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-50">
        <div className="flex items-center gap-2 text-surface-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-surface-300 border-t-surface-600" />
          Checking your account...
        </div>
      </div>
    );
  }

  // Logged-out visitors get the public "Check My Lot" map: search an address,
  // fly to the house, then sign in to unlock the full planning flow.
  if (!isLoggedIn) {
    return <HeroLotPreview fullScreen />;
  }

  return <>{children}</>;
}
