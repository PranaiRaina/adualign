import type { ListingDraft, ListingFieldMeta } from '@/lib/types/listing';

export interface StructuredReportData {
  visible?: {
    executive_summary?: string | null;
    property_overview?: string | null;
    zoning_analysis?: string | null;
    financial_snapshot?: string | null;
    recommendations?: string | null;
  } | null;
  context?: {
    key_questions?: string[];
    implicit_preferences?: string[];
    notable_signals?: string[];
  } | null;
}

export interface MergeChange {
  field: string;
  type: 'new' | 'appended' | 'conflict';
  currentValue: string;
  incomingValue: string;
}

export interface ListingDraftApiResponse {
  action: 'create' | 'merge';
  draftId?: string | null;
  projectId?: string | null;
  listing: ListingDraft;
  fieldMeta: ListingFieldMeta;
  proposedListing?: ListingDraft | null;
  proposedFieldMeta?: ListingFieldMeta;
  changes?: MergeChange[];
}

export function persistListingDraftToStorage(
  listingId: string,
  listing: ListingDraft,
  fieldMeta: ListingFieldMeta,
) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`adu-listing-draft-${listingId}`, JSON.stringify(listing));
  localStorage.setItem(`adu-listing-meta-${listingId}`, JSON.stringify(fieldMeta));
}
