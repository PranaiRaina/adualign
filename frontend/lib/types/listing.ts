// ── Field Source & Status Tracking ──

export type FieldSource = 'wizard' | 'user' | 'agent' | 'calculated';
export type FieldStatus = 'auto-filled' | 'user-edited' | 'empty';

export interface FieldMeta {
  source: FieldSource;
  status: FieldStatus;
}

// ── ADU Enums ──

export type AduType =
  | 'detached'
  | 'attached'
  | 'garage_conversion'
  | 'junior_adu'
  | 'above_garage'
  | 'basement';

export function normalizeMarketplaceAduType(value: string | null | undefined): AduType | null {
  if (!value) return null;
  if (
    value === 'detached' ||
    value === 'attached' ||
    value === 'garage_conversion' ||
    value === 'junior_adu' ||
    value === 'above_garage' ||
    value === 'basement'
  ) {
    return value;
  }
  if (value === 'jadu') return 'junior_adu';
  return null;
}

export type ConstructionStatus =
  | 'pre_construction'
  | 'under_construction'
  | 'recently_completed'
  | 'established';

export type PermitStatus = 'verified' | 'unverified' | 'pending';
export type ListingStatus = 'project' | 'draft' | 'published' | 'archived' | 'report';
export type ProjectStatus = 'project' | 'new' | 'report' | 'draft' | 'published' | 'archived';
export type ReportStatus = 'not_generated' | 'current' | 'outdated';

export function normalizeProjectStatus(status: string | null | undefined): ProjectStatus {
  if (status === 'published' || status === 'archived') {
    return status;
  }
  return 'project';
}

export interface ProjectOut {
  id: string;
  user_id: string;
  status: ProjectStatus;
  address: string | null;
  county: string | null;
  property_area_sqft: number | null;
  buildable_area_sqft: number | null;
  setback_ft: number | null;
  max_adu_sqft: number | null;
  adu_sqft: number | null;
  adu_width_ft: number | null;
  adu_length_ft: number | null;
  adu_type: string | null;
  adu_shape: string | null;
  primary_use: string | null;
  blocker_types: string[] | null;
  fire_hazard_severity: string | null;
  fire_hazard_zone_type: string | null;
  current_yard_zone: string | null;
  adu_clearances:
    | {
        direction: string;
        target_kind: string;
        distance_feet: number;
        target_structure_index?: number | null;
      }[]
    | null;
  finance_state: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  has_report: boolean;
  report_status: ReportStatus;
  has_draft: boolean;
  draft_bedrooms: number | null;
  draft_bathrooms: number | null;
  draft_monthly_rent: number | null;
  draft_hero_image: string | null;
}

export interface DraftOut {
  id: string;
  project_id: string;
  seller_id: string;
  version: number;
  draft_payload: Record<string, any>;
  field_meta: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type KitchenType = 'full' | 'kitchenette' | 'none';
export type LaundryType = 'in_unit' | 'hookups' | 'shared' | 'none';
export type SellerType = 'homeowner' | 'investor' | 'developer' | 'property_manager';
export type ContactPreference = 'email' | 'phone' | 'in_app' | 'any';
export type LeaseTermType = 'month_to_month' | '6_month' | '1_year' | '2_year';
export type UtilitiesStrategy = 'separate' | 'shared' | 'included';
export type ClimateControl = 'mini_split' | 'central' | 'window_unit' | 'none';
export type FurnishedStatus = 'unfurnished' | 'partially' | 'fully';

// ── Listing Draft (all fields for the canvas editor) ──

export interface ListingDraft {
  id: string;
  projectId?: string | null;
  status: ListingStatus;
  hasReport?: boolean;
  reportStatus?: ReportStatus;

  // SECTION 1: Hero
  heroImage: string;
  headline: string;
  aduType: AduType | null;
  constructionStatus: ConstructionStatus | null;

  // SECTION 2: Core Details
  address: string;
  city: string;
  state: string;
  zipCode: string;
  neighborhood: string;
  apn: string;
  lat: number | null;
  lng: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  privateEntrance: boolean | null;
  unitLevel: string;
  kitchenType: KitchenType | null;
  inUnitLaundry: LaundryType | null;

  // SECTION 3: Legal & Trust
  permitStatus: PermitStatus | null;
  certificateOfOccupancy: boolean | null;
  zoningDesignation: string;
  legalRentalStatus: boolean | null;
  hoaRestrictions: string;
  shortTermRentalAllowed: boolean | null;

  // SECTION 4: Financials
  monthlyRent: number | null;
  securityDeposit: number | null;
  leaseTerm: LeaseTermType | null;
  utilitiesStrategy: UtilitiesStrategy | null;
  capRate: number | null;
  grossYield: number | null;
  paybackPeriod: number | null;
  constructionCost: number | null;

  // SECTION 5: Media
  floorPlanImage: string;
  imageGallery: string[];
  videoTourUrl: string;

  // SECTION 6: Seller Info
  sellerType: SellerType | null;
  contactPreference: ContactPreference | null;
  responseTime: string;
  sellerName: string;
  sellerId: string;

  // SECTION 7: Optional Upgrades
  outdoorSpace: string;
  parkingDetails: string;
  climateControl: ClimateControl | null;
  neighborhoodInfo: string;
  investorMetrics: string;
  smartHomeFeatures: string;
  furnished: FurnishedStatus | null;
  proximityToEmployers: string;
  petPolicy: string;

  // Legacy marketplace fields (backward compat)
  images: string[];
  amenities: string[];
  availableDate: string;
  utilitiesIncluded: ('water' | 'trash' | 'electric' | 'electricity' | 'gas' | 'internet')[];
  parkingIncluded: boolean;
  petsAllowed?: boolean;
  viewCount: number;
  saveCount: number;

  // Description
  description: string;
  seoTitle: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ── Field metadata map ──

export type ListingFieldKey = keyof ListingDraft;

export type ListingFieldMeta = Partial<Record<ListingFieldKey, FieldMeta>>;

// ── Required vs Optional field lists ──

export const REQUIRED_FIELDS: ListingFieldKey[] = [
  'heroImage',
  'bedrooms',
  'bathrooms',
  'privateEntrance',
  'kitchenType',
  'inUnitLaundry',
  'leaseTerm',
  'utilitiesStrategy',
  'contactPreference',
];

export const OPTIONAL_FIELDS: ListingFieldKey[] = [
  'parkingDetails',
  'outdoorSpace',
  'climateControl',
  'furnished',
  'proximityToEmployers',
  'petPolicy',
];

// ── Field display labels ──

export const FIELD_LABELS: Partial<Record<ListingFieldKey, string>> = {
  heroImage: 'Hero Image',
  headline: 'Listing Headline',
  aduType: 'ADU Type',
  constructionStatus: 'Construction Status',
  address: 'Address',
  city: 'City',
  state: 'State',
  zipCode: 'ZIP Code',
  neighborhood: 'Neighborhood',
  apn: 'Parcel Number (APN)',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  sqft: 'Square Footage',
  privateEntrance: 'Private Entrance',
  unitLevel: 'Unit Level',
  kitchenType: 'Kitchen Type',
  inUnitLaundry: 'In-Unit Laundry',
  permitStatus: 'Permit Status',
  certificateOfOccupancy: 'Certificate of Occupancy',
  zoningDesignation: 'Zoning Designation',
  legalRentalStatus: 'Legal Rental Status',
  hoaRestrictions: 'HOA Restrictions',
  shortTermRentalAllowed: 'Short-Term Rental',
  monthlyRent: 'Monthly Rent',
  securityDeposit: 'Security Deposit',
  leaseTerm: 'Lease Term',
  utilitiesStrategy: 'Utilities Strategy',
  capRate: 'Cap Rate',
  grossYield: 'Gross Yield',
  paybackPeriod: 'Payback Period',
  constructionCost: 'Construction Cost',
  floorPlanImage: 'Floor Plan',
  imageGallery: 'Image Gallery',
  videoTourUrl: 'Video Tour URL',
  sellerType: 'Seller Type',
  contactPreference: 'Contact Preference',
  responseTime: 'Response Time',
  outdoorSpace: 'Outdoor Space',
  parkingDetails: 'Parking Details',
  climateControl: 'Climate Control',
  neighborhoodInfo: 'Neighborhood Info',
  investorMetrics: 'Investor Metrics',
  smartHomeFeatures: 'Smart Home Features',
  furnished: 'Furnished Status',
  proximityToEmployers: 'Proximity to Employers',
  description: 'Description',
  petPolicy: 'Pet Policy',
};

// ── ProjectState from wizard steps ──

export interface WizardStep1 {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  neighborhood: string;
  apn: string;
  lat: number;
  lng: number;
}

export interface WizardStep2 {
  lotSqft: number;
  buildableSqft: number;
  maxAduSqft: number;
  setbacks: string;
  zoningDesignation: string;
  satelliteImageUrl: string;
  overlayImageUrl: string;
  spatialEligibility: boolean;
}

export interface WizardStep3 {
  permitStatus: PermitStatus;
  certificateOfOccupancy: boolean;
  legalRentalStatus: boolean;
  hoaRestrictions: string;
  shortTermRentalAllowed: boolean;
  criteriaPassed: number;
  criteriaTotal: number;
  isOwner: boolean;
  hasHoa: boolean;
  intendedUse: string;
  aduTypePreference: AduType;
  budgetRange: string;
  timeline: string;
}

export interface WizardStep4 {
  monthlyRentEstimate: number;
  constructionCostLow: number;
  constructionCostMid: number;
  constructionCostHigh: number;
  capRate: number;
  grossYield: number;
  paybackPeriodYears: number;
}

export interface ProjectState {
  step1: WizardStep1;
  step2: WizardStep2;
  step3: WizardStep3;
  step4: WizardStep4;
}

// ── Legacy compat export ──

export type { ListingDraft as Listing };
