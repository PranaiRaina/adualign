'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ListingDraft,
  ListingFieldMeta,
  ListingFieldKey,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  FieldMeta,
  DraftOut,
} from '../types/listing';
import { getAuthHeaders } from '../utils/supabase/authHeaders';
import { redirectToLogin } from '../utils/authRedirect';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function isFieldFilled(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Hook for managing drafts via the /projects/{projectId}/draft API.
 * Replaces the old useListingGenerator's save-to-listings flow.
 */
export function useDraft(projectId: string) {
  const [listing, setListing] = useState<ListingDraft | null>(null);
  const [fieldMeta, setFieldMeta] = useState<ListingFieldMeta>({});
  const [version, setVersion] = useState<number>(1);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId || projectId === 'new') {
      const now = new Date().toISOString();
      setListing({
        id: 'new',
        status: 'draft',
        heroImage: '',
        headline: '',
        aduType: null,
        constructionStatus: null,
        address: '',
        city: '',
        state: 'CA',
        zipCode: '',
        neighborhood: '',
        apn: '',
        lat: null,
        lng: null,
        bedrooms: null,
        bathrooms: null,
        sqft: null,
        privateEntrance: null,
        unitLevel: '',
        kitchenType: null,
        inUnitLaundry: null,
        permitStatus: null,
        certificateOfOccupancy: null,
        zoningDesignation: '',
        legalRentalStatus: null,
        hoaRestrictions: '',
        shortTermRentalAllowed: null,
        monthlyRent: null,
        securityDeposit: null,
        leaseTerm: null,
        utilitiesStrategy: null,
        capRate: null,
        grossYield: null,
        paybackPeriod: null,
        constructionCost: null,
        floorPlanImage: '',
        imageGallery: [],
        videoTourUrl: '',
        sellerType: null,
        contactPreference: null,
        responseTime: '',
        sellerName: '',
        sellerId: '',
        outdoorSpace: '',
        parkingDetails: '',
        climateControl: null,
        neighborhoodInfo: '',
        investorMetrics: '',
        smartHomeFeatures: '',
        furnished: null,
        proximityToEmployers: '',
        petPolicy: '',
        images: [],
        amenities: [],
        availableDate: '',
        utilitiesIncluded: [],
        parkingIncluded: false,
        viewCount: 0,
        saveCount: 0,
        description: '',
        seoTitle: '',
        createdAt: now,
        updatedAt: now,
      } as ListingDraft);
      setHydrated(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchDraft = async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/projects/${projectId}/draft`, { headers });

        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (res.status === 404) {
          setHydrated(true);
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch draft');

        const data: DraftOut = await res.json();
        if (cancelled) return;

        const payload = data.draft_payload || {};
        setListing(payload as ListingDraft);
        setFieldMeta((data.field_meta || {}) as ListingFieldMeta);
        setVersion(data.version);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setHydrated(true);
          setLoading(false);
        }
      }
    };

    fetchDraft();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const saveDraft = useCallback(
    async (nextListing: ListingDraft, nextMeta: ListingFieldMeta) => {
      if (!projectId || projectId === 'new') return;
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/projects/${projectId}/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            draft_payload: nextListing,
            field_meta: nextMeta,
          }),
        });
        if (res.status === 401) {
          redirectToLogin();
        }
      } catch (err) {
        console.error('Failed to save draft:', err);
      }
    },
    [projectId],
  );

  const debouncedSave = useCallback(
    (nextListing: ListingDraft, nextMeta: ListingFieldMeta) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveDraft(nextListing, nextMeta), 800);
    },
    [saveDraft],
  );

  const updateField = useCallback(
    (fieldKey: string, value: any) => {
      setListing((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [fieldKey]: value };
        const nextMeta = {
          ...fieldMeta,
          [fieldKey]: { source: 'user', status: 'user-edited' } as FieldMeta,
        };
        setFieldMeta(nextMeta);
        debouncedSave(next, nextMeta);
        return next;
      });
    },
    [fieldMeta, debouncedSave],
  );

  const replaceDraft = useCallback(
    (nextListing: ListingDraft, nextMeta: ListingFieldMeta) => {
      setListing(nextListing);
      setFieldMeta(nextMeta);
      saveDraft(nextListing, nextMeta);
    },
    [saveDraft],
  );

  const publishProject = useCallback(async () => {
    if (!projectId) return;
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/projects/${projectId}/publish`, {
      method: 'POST',
      headers,
    });
    if (res.status === 401) {
      redirectToLogin();
      throw new Error('Authentication required');
    }
    if (!res.ok) throw new Error('Publish failed');
    return res.json();
  }, [projectId]);

  const autoFilledCount = useMemo(() => {
    return Object.values(fieldMeta).filter((m) => m?.status === 'auto-filled').length;
  }, [fieldMeta]);

  const requiredMissing = useMemo(() => {
    if (!listing) return REQUIRED_FIELDS;
    return REQUIRED_FIELDS.filter((key) => !isFieldFilled((listing as any)[key]));
  }, [listing]);

  const optionalMissing = useMemo(() => {
    if (!listing) return OPTIONAL_FIELDS;
    return OPTIONAL_FIELDS.filter((key) => !isFieldFilled((listing as any)[key]));
  }, [listing]);

  const isPublishReady = requiredMissing.length === 0;

  const nextMissingField: ListingFieldKey | null = useMemo(() => {
    if (requiredMissing.length > 0) return requiredMissing[0];
    if (optionalMissing.length > 0) return optionalMissing[0];
    return null;
  }, [requiredMissing, optionalMissing]);

  return {
    listing,
    fieldMeta,
    version,
    updateField,
    replaceDraft,
    saveDraft,
    publishProject,
    autoFilledCount,
    requiredMissingCount: requiredMissing.length,
    optionalMissingCount: optionalMissing.length,
    isPublishReady,
    nextMissingField,
    requiredMissing,
    optionalMissing,
    hydrated,
    loading,
    error,
  };
}
