'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useListings } from '@/lib/hooks/useListings';
import { ListingDetail } from '@/components/marketplace/ListingDetail';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

export default function ListingPage() {
  // Next 16: the params prop is a Promise; useParams gives sync access.
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { getListingById, isLoaded } = useListings();
  const listing = getListingById(id);

  useEffect(() => {
    if (!ENABLE_LISTING_MARKETPLACE) {
      router.replace('/map');
    }
  }, [router]);

  if (!ENABLE_LISTING_MARKETPLACE) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Header />
        <main className="flex-1 flex items-center justify-center text-slate-500">
          Redirecting to lot feasibility...
        </main>
        <Footer />
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Header />
        <main className="flex-1 flex items-center justify-center text-slate-500">
          Loading listing...
        </main>
        <Footer />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Header />
        <main className="flex-1 flex items-center justify-center flex-col">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Listing Not Found</h1>
          <p className="text-slate-500">This ADU listing may have been moved or deleted.</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header />
      <main className="flex-1">
        <ListingDetail listing={listing as any} />
      </main>
      <Footer />
    </div>
  );
}
