import { Listing } from '@/lib/types/listing';
import { ListingCard } from '@/components/marketplace/ListingCard';
import { Search, HeartOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

interface SavedListingsGridProps {
  listings: Listing[];
}

export function SavedListingsGrid({ listings }: SavedListingsGridProps) {
  if (listings.length === 0) {
    return (
      <div className="text-center py-24 bg-white rounded-xl border border-dashed border-slate-300">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
          <HeartOff className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">No saved ADUs</h3>
        <p className="text-slate-500 mb-8 max-w-sm mx-auto">
          Marketplace browsing is temporarily paused while listing pages are disconnected.
        </p>
        {ENABLE_LISTING_MARKETPLACE && (
          <Button
            asChild
            size="lg"
            className="bg-slate-900 hover:bg-slate-800 text-white font-medium"
          >
            <Link href="/marketplace">
              Browse Marketplace <Search className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>

      {ENABLE_LISTING_MARKETPLACE && (
        <div className="text-center pt-8 border-t border-slate-200">
          <Button
            asChild
            variant="outline"
            size="lg"
            className="border-slate-300 font-medium text-slate-700"
          >
            <Link href="/marketplace">
              Discover more ADUs <Search className="w-4 h-4 ml-2 opacity-50" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
