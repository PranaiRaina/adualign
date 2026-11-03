import { Listing } from '@/lib/types/listing';
import { ListingCard } from './ListingCard';

interface ListingGridProps {
  listings: Listing[];
}

export function ListingGrid({ listings }: ListingGridProps) {
  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center bg-surface-50 rounded-2xl border border-surface-200 border-dashed">
        <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mb-6">
          <svg
            className="w-8 h-8 text-surface-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-surface-900 mb-2">No ADUs found</h3>
        <p className="text-surface-500 max-w-sm mx-auto leading-relaxed">
          We couldn&apos;t find any properties matching your exact filters. Try broadening your
          search criteria or adjusting the price range.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header removed as it is now handled by the parent page */}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}
