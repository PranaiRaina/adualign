import { Listing, AduType, PermitStatus } from '../types/listing';

export interface FilterState {
  aduTypes: AduType[];
  permitStatuses: PermitStatus[];
  minPrice: number;
  maxPrice: number;
  minBedrooms: number | null;
  minBathrooms: number | null;
  privateEntrance: boolean;
  inUnitLaundry: boolean;
  parkingIncluded: boolean;
  petsAllowed: boolean;
  requireVerifiedPermit: boolean;
  cities: string[];
  sortBy: 'newest' | 'price_asc' | 'price_desc' | 'most_viewed';
}

// Alias for backward compatibility
export type ListingFilters = FilterState;

export const defaultFilters: FilterState = {
  aduTypes: [],
  permitStatuses: [],
  minPrice: 0,
  maxPrice: 10000,
  minBedrooms: null,
  minBathrooms: null,
  privateEntrance: false,
  inUnitLaundry: false,
  parkingIncluded: false,
  petsAllowed: false,
  requireVerifiedPermit: false,
  cities: [],
  sortBy: 'newest',
};

export function filterListings(
  listings: Listing[],
  filters: FilterState,
  searchQuery: string,
): Listing[] {
  return listings
    .filter((l) => l.status === 'published')
    .filter((l) => !filters.aduTypes.length || (l.aduType && filters.aduTypes.includes(l.aduType)))
    .filter((l) => {
      if (!filters.permitStatuses.length && !filters.requireVerifiedPermit) return true;
      if (filters.requireVerifiedPermit) return l.permitStatus === 'verified';
      return l.permitStatus && filters.permitStatuses.includes(l.permitStatus);
    })
    .filter(
      (l) => (l.monthlyRent ?? 0) >= filters.minPrice && (l.monthlyRent ?? 0) <= filters.maxPrice,
    )
    .filter((l) => filters.minBedrooms === null || (l.bedrooms ?? 0) >= filters.minBedrooms)
    .filter((l) => filters.minBathrooms === null || (l.bathrooms ?? 0) >= filters.minBathrooms)
    .filter((l) => !filters.privateEntrance || l.privateEntrance)
    .filter((l) => !filters.inUnitLaundry || l.inUnitLaundry)
    .filter((l) => !filters.parkingIncluded || l.parkingIncluded)
    .filter((l) => !filters.petsAllowed || l.petsAllowed)
    .filter((l) => !filters.cities.length || filters.cities.includes(l.city))
    .filter((l) => !searchQuery || matchesSearch(l, searchQuery))
    .sort((a, b) => sortListings(a, b, filters.sortBy));
}

function matchesSearch(listing: Listing, query: string): boolean {
  const q = query.toLowerCase();
  return (
    listing.address.toLowerCase().includes(q) ||
    listing.city.toLowerCase().includes(q) ||
    (listing.neighborhood?.toLowerCase().includes(q) ?? false) ||
    listing.description?.toLowerCase().includes(q)
  );
}

function sortListings(a: Listing, b: Listing, sortBy: string): number {
  switch (sortBy) {
    case 'price_asc':
      return (a.monthlyRent ?? 0) - (b.monthlyRent ?? 0);
    case 'price_desc':
      return (b.monthlyRent ?? 0) - (a.monthlyRent ?? 0);
    case 'most_viewed':
      return b.viewCount - a.viewCount;
    case 'newest':
    default:
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }
}
