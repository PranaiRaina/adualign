'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ListingDraft,
  ListingFieldMeta,
  ListingFieldKey,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  FieldMeta,
} from '../types/listing';
import { mapWizardToListing, MOCK_PROJECT_STATE } from '../mock/wizard-to-listing';
import type { ProjectState } from '../types/listing';
import { MOCK_LISTINGS } from '../mock/listings';

function getStorageKeys(listingId: string) {
  return {
    STORAGE_KEY_LISTING: `adu-listing-draft-${listingId}`,
    STORAGE_KEY_META: `adu-listing-meta-${listingId}`,
  };
}

function isFieldFilled(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function saveToStorage(key: string, value: any) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded */
  }
}

export function useListingGenerator(listingId: string = 'new', projectState?: ProjectState) {
  const { STORAGE_KEY_LISTING, STORAGE_KEY_META } = useMemo(
    () => getStorageKeys(listingId),
    [listingId],
  );
  const _noop = async (_listing: ListingDraft, _meta?: Record<string, any>) => {};
  const saveListing = _noop;

  const initial = useMemo(() => {
    if (projectState) return mapWizardToListing(projectState);
    const existing = MOCK_LISTINGS.find((l) => l.id === listingId);

    if (existing) {
      const meta: ListingFieldMeta = {};
      for (const key of Object.keys(existing)) {
        if (isFieldFilled((existing as any)[key])) {
          meta[key as keyof ListingDraft] = {
            source: 'system',
            status: 'verified',
          } as unknown as FieldMeta;
        }
      }
      return { listing: existing as unknown as ListingDraft, fieldMeta: meta };
    }
    // For new project, initialize fresh with blank fields where appropriate
    // (Assuming mapWizardToListing handles starting a generic new draft)
    const blankStart = mapWizardToListing(MOCK_PROJECT_STATE);
    if (listingId === 'new') {
      blankStart.listing.address = '';
      blankStart.listing.bedrooms = null as any;
      blankStart.listing.bathrooms = null as any;
      blankStart.listing.sqft = null as any;
      blankStart.listing.monthlyRent = null as any;
      blankStart.listing.description = '';
      blankStart.listing.images = [];
      blankStart.listing.heroImage = '';
    }
    return blankStart;
  }, [listingId, projectState]);

  // Always start with wizard defaults to avoid hydration mismatch
  const [listing, setListing] = useState<ListingDraft>(initial.listing);
  const [fieldMeta, setFieldMeta] = useState<ListingFieldMeta>(initial.fieldMeta);
  const [hydrated, setHydrated] = useState(false);
  const skipNextSave = useRef(false);

  // Hydrate from localStorage AFTER first render (client-only)
  useEffect(() => {
    try {
      const savedListing = localStorage.getItem(STORAGE_KEY_LISTING);
      const savedMeta = localStorage.getItem(STORAGE_KEY_META);
      if (savedListing) {
        skipNextSave.current = true;
        setListing(JSON.parse(savedListing));
      } else {
        // Check if it's in the user-listings array
        const allListingsStr = localStorage.getItem('plotalign-user-listings');
        if (allListingsStr) {
          const allListings = JSON.parse(allListingsStr);
          const specific = allListings.find((l: any) => l.id === listingId);
          if (specific) {
            skipNextSave.current = true;
            setListing(specific);
          }
        }
      }
      if (savedMeta) {
        skipNextSave.current = true;
        setFieldMeta(JSON.parse(savedMeta));
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [STORAGE_KEY_LISTING, STORAGE_KEY_META, listingId]);

  // Persist on every change (skip the hydration write-back)
  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveToStorage(STORAGE_KEY_LISTING, listing);
  }, [listing, hydrated, STORAGE_KEY_LISTING]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveToStorage(STORAGE_KEY_META, fieldMeta);
  }, [fieldMeta, hydrated, STORAGE_KEY_META]);

  const updateField = useCallback(
    (fieldKey: string, value: any) => {
      const nextListing = { ...listing, [fieldKey]: value };
      const nextMeta = {
        ...fieldMeta,
        [fieldKey]: { source: 'user', status: 'user-edited' } as FieldMeta,
      };

      setListing(nextListing);
      setFieldMeta(nextMeta);
      saveToStorage(STORAGE_KEY_LISTING, nextListing);
      saveToStorage(STORAGE_KEY_META, nextMeta);
      saveListing(nextListing, nextMeta);
    },
    [STORAGE_KEY_LISTING, STORAGE_KEY_META, saveListing, listing, fieldMeta],
  );

  const replaceDraft = useCallback(
    (nextListing: ListingDraft, nextMeta: ListingFieldMeta) => {
      setListing(nextListing);
      setFieldMeta(nextMeta);
      saveToStorage(STORAGE_KEY_LISTING, nextListing);
      saveToStorage(STORAGE_KEY_META, nextMeta);
      saveListing(nextListing, nextMeta);
    },
    [STORAGE_KEY_LISTING, STORAGE_KEY_META, saveListing],
  );

  const autoFilledCount = useMemo(() => {
    return Object.values(fieldMeta).filter((m) => m?.status === 'auto-filled').length;
  }, [fieldMeta]);

  const requiredMissing = useMemo(() => {
    return REQUIRED_FIELDS.filter((key) => !isFieldFilled((listing as any)[key]));
  }, [listing]);

  const optionalMissing = useMemo(() => {
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
    updateField,
    replaceDraft,
    autoFilledCount,
    requiredMissingCount: requiredMissing.length,
    optionalMissingCount: optionalMissing.length,
    isPublishReady,
    nextMissingField,
    requiredMissing,
    optionalMissing,
    hydrated,
  };
}
