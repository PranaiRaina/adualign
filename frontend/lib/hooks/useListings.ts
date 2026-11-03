'use client';

import { useMemo, useState, useEffect } from 'react';
import { FilterState, filterListings, defaultFilters } from '../utils/filters';
import { ListingDraft, normalizeMarketplaceAduType } from '../types/listing';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Fetch published marketplace listings only.
 * Draft management is now handled by useDraft via /projects/{id}/draft.
 */
export function useListings(filters: FilterState = defaultFilters, searchQuery: string = '') {
  const [allListings, setAllListings] = useState<ListingDraft[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        const response = await fetch(`${API_URL}/listings/`);
        if (!response.ok) throw new Error('Failed to fetch listings');

        const data = await response.json();

        const mappedData: ListingDraft[] = data.map((item: any) => ({
          id: item.id,
          projectId: item.project_id ?? null,
          status: 'published' as const,
          address: item.address ?? '',
          city: item.city ?? '',
          state: item.state ?? '',
          zipCode: item.zip_code ?? '',
          lat: item.lat ?? null,
          lng: item.lng ?? null,
          bedrooms: item.bedrooms ?? null,
          bathrooms: item.bathrooms ?? null,
          sqft: item.sqft ?? null,
          monthlyRent: item.monthly_rent ?? null,
          aduType: normalizeMarketplaceAduType(item.adu_type),
          permitStatus: item.permit_status ?? null,
          heroImage: item.hero_image ?? '',
          imageGallery: item.image_gallery ?? [],
          description: item.description ?? '',
          seoTitle: item.seo_title ?? '',
          amenities: item.amenities ?? [],
          utilitiesIncluded: item.utilities_included ?? [],
          leaseTerm: item.lease_term ?? null,
          petPolicy: item.pet_policy ?? '',
          availableDate: item.available_date ?? '',
          furnished: item.furnished ?? null,
          sellerId: item.seller_id,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          viewCount: item.view_count ?? 0,
          saveCount: item.save_count ?? 0,
          headline: '',
          constructionStatus: null,
          neighborhood: '',
          apn: '',
          privateEntrance: null,
          unitLevel: '',
          kitchenType: null,
          inUnitLaundry: null,
          certificateOfOccupancy: null,
          zoningDesignation: '',
          legalRentalStatus: null,
          hoaRestrictions: '',
          shortTermRentalAllowed: null,
          securityDeposit: null,
          utilitiesStrategy: null,
          capRate: null,
          grossYield: null,
          paybackPeriod: null,
          constructionCost: null,
          floorPlanImage: '',
          videoTourUrl: '',
          sellerType: null,
          contactPreference: null,
          responseTime: '',
          sellerName: '',
          outdoorSpace: '',
          parkingDetails: '',
          climateControl: null,
          neighborhoodInfo: '',
          investorMetrics: '',
          smartHomeFeatures: '',
          proximityToEmployers: '',
          images: [],
          parkingIncluded: false,
        }));

        setAllListings(mappedData);
      } catch (err: any) {
        console.error('Error loading marketplace listings:', err);
        setError(err.message);
      } finally {
        setIsLoaded(true);
      }
    };

    fetchListings();
  }, []);

  const filteredListings = useMemo(() => {
    return filterListings(allListings as any, filters, searchQuery);
  }, [allListings, filters, searchQuery]);

  const getListingById = (id: string) => {
    return allListings.find((l) => l.id === id) || null;
  };

  return {
    listings: filteredListings,
    totalCount: filteredListings.length,
    allListings,
    getListingById,
    isLoaded,
    error,
  };
}
