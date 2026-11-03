import { Listing } from '@/lib/types/listing';
import Image from 'next/image';
import Link from 'next/link';
import { formatCurrency, formatSqft, formatRelativeTime } from '@/lib/utils/formatting';
import { AduTypeBadge } from './AduTypeBadge';
import { PermitBadge } from './PermitBadge';
import { SaveButton } from './SaveButton';
import { MapPin } from 'lucide-react';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

interface ListingCardProps {
  listing: Listing;
}

export function ListingCard({ listing }: ListingCardProps) {
  const card = (
    <div className="group block">
      <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all hover:-translate-y-1">
        {/* Image Area - Aspect 4/3 */}
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
          <Image
            src={listing.heroImage}
            alt={listing.seoTitle}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />

          {/* Top Badges overlay */}
          <div className="absolute top-3 left-3 z-10">
            <AduTypeBadge type={listing.aduType!} />
          </div>
          <div className="absolute top-3 right-3 z-10 flex">
            <SaveButton listingId={listing.id} />
          </div>
        </div>

        {/* Content Area */}
        <div className="p-4 flex flex-col flex-grow">
          <div className="flex justify-between items-start mb-2">
            <h2 className="text-2xl font-bold text-slate-900">
              {formatCurrency(listing.monthlyRent || 0)}
              <span className="text-sm font-normal text-slate-500">/mo</span>
            </h2>
          </div>

          <p className="text-sm text-slate-500 mb-3">
            {listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`}
            <span className="mx-1"> • </span>
            {listing.bathrooms} bath
            <span className="mx-1"> • </span>
            {formatSqft(listing.sqft || 0)}
          </p>

          <p className="text-sm font-medium text-slate-700 flex items-center gap-1 mb-4">
            <MapPin className="w-3.5 h-3.5 text-slate-400" /> {listing.city}, {listing.state}
          </p>

          <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
            <PermitBadge status={listing.permitStatus!} showIcon={true} />
            <span className="text-xs text-slate-400">{formatRelativeTime(listing.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (!ENABLE_LISTING_MARKETPLACE) return card;

  return (
    <Link href={`/marketplace/${listing.id}`} className="block">
      {card}
    </Link>
  );
}
