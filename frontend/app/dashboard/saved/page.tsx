'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSaved } from '@/lib/context/SavedContext';
import { StatsBar } from '@/components/dashboard/StatsBar';
import { SavedListingsGrid } from '@/components/dashboard/SavedListingsGrid';
import { Heart, Search, BellRing, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { MOCK_LISTINGS } from '@/lib/mock/listings';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

export default function BuyerSavedPage() {
  const { user, isLoading } = useAuth();
  const { savedListings } = useSaved();
  const router = useRouter();

  useEffect(() => {
    if (!ENABLE_LISTING_MARKETPLACE) {
      router.replace('/map');
    }
  }, [router]);

  if (isLoading || !user) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-slate-400 flex flex-col items-center">
          <Loader2 className="w-8 h-8 animate-spin mb-2" />
          {isLoading ? 'Loading...' : 'Redirecting...'}
        </div>
      </div>
    );
  }

  // Map saved IDs to actual full listing objects
  const savedListingsData = savedListings
    .map((id) => MOCK_LISTINGS.find((l) => l.id === id))
    .filter((l) => l !== undefined);

  const stats = [
    { label: 'Saved ADUs', value: savedListings.length, icon: Heart },
    { label: 'New Matches', value: '12', icon: Search, trend: 'This week' },
    { label: 'Price Alerts', value: '3', icon: BellRing },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Saved ADUs</h1>
        <p className="text-slate-500 mt-1">
          Keep track of your favorite properties and price changes.
        </p>
      </div>

      <StatsBar stats={stats} />

      <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm">
        <SavedListingsGrid listings={savedListingsData as any} />
      </div>
    </div>
  );
}
