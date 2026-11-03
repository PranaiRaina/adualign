import {
  ListingDraft,
  ListingFieldMeta,
  ProjectState,
  ConstructionStatus,
  FieldMeta,
  ListingFieldKey,
} from '../types/listing';

function autoMeta(): FieldMeta {
  return { source: 'wizard', status: 'auto-filled' };
}

function calcMeta(): FieldMeta {
  return { source: 'calculated', status: 'auto-filled' };
}

function emptyMeta(): FieldMeta {
  return { source: 'wizard', status: 'empty' };
}

function deriveConstructionStatus(timeline: string): ConstructionStatus | null {
  const t = timeline.toLowerCase();
  if (t.includes('not started') || t.includes('planning')) return 'pre_construction';
  if (t.includes('under construction') || t.includes('building')) return 'under_construction';
  if (t.includes('complete') || t.includes('finished') || t.includes('recent'))
    return 'recently_completed';
  if (t.includes('established') || t.includes('existing')) return 'established';
  return null;
}

function generateHeadline(state: ProjectState): string {
  const type = state.step3.aduTypePreference || 'ADU';
  const typeLabel =
    type === 'detached'
      ? 'Detached ADU'
      : type === 'garage_conversion'
        ? 'Garage Conversion ADU'
        : type === 'attached'
          ? 'Attached ADU'
          : type === 'junior_adu'
            ? 'Junior ADU'
            : type === 'above_garage'
              ? 'Above-Garage ADU'
              : type === 'basement'
                ? 'Basement ADU'
                : 'ADU';

  const neighborhood = state.step1.neighborhood || state.step1.city;
  return `${typeLabel} in ${neighborhood}, ${state.step1.city}`;
}

export function mapWizardToListing(
  state: ProjectState,
  id: string = 'draft-1',
): { listing: ListingDraft; fieldMeta: ListingFieldMeta } {
  const now = new Date().toISOString();
  const constructionStatus = deriveConstructionStatus(state.step3.timeline);

  const listing: ListingDraft = {
    id,
    status: 'draft',

    // Hero
    heroImage: '',
    headline: generateHeadline(state),
    aduType: state.step3.aduTypePreference || null,
    constructionStatus,

    // Core Details
    address: state.step1.address,
    city: state.step1.city,
    state: state.step1.state,
    zipCode: state.step1.zipCode,
    neighborhood: state.step1.neighborhood,
    apn: state.step1.apn,
    lat: state.step1.lat,
    lng: state.step1.lng,
    bedrooms: null,
    bathrooms: null,
    sqft: state.step2.maxAduSqft,
    privateEntrance: null,
    unitLevel: '',
    kitchenType: null,
    inUnitLaundry: null,

    // Legal & Trust
    permitStatus: state.step3.permitStatus,
    certificateOfOccupancy: state.step3.certificateOfOccupancy,
    zoningDesignation: state.step2.zoningDesignation,
    legalRentalStatus: state.step3.legalRentalStatus,
    hoaRestrictions: state.step3.hoaRestrictions,
    shortTermRentalAllowed: state.step3.shortTermRentalAllowed,

    // Financials
    monthlyRent: state.step4.monthlyRentEstimate,
    securityDeposit: state.step4.monthlyRentEstimate * 2,
    leaseTerm: null,
    utilitiesStrategy: null,
    capRate: state.step4.capRate,
    grossYield: state.step4.grossYield,
    paybackPeriod: state.step4.paybackPeriodYears,
    constructionCost: state.step4.constructionCostMid,

    // Media
    floorPlanImage: '',
    imageGallery: [],
    videoTourUrl: '',

    // Seller Info
    sellerType: null,
    contactPreference: null,
    responseTime: '',
    sellerName: '',
    sellerId: '',

    // Optional Upgrades
    outdoorSpace: '',
    parkingDetails: '',
    climateControl: null,
    neighborhoodInfo: '',
    investorMetrics: '',
    smartHomeFeatures: '',
    furnished: null,
    proximityToEmployers: '',
    petPolicy: '',

    // Legacy marketplace fields
    images: [],
    amenities: [],
    availableDate: '',
    utilitiesIncluded: [],
    parkingIncluded: false,
    viewCount: 0,
    saveCount: 0,

    // Description
    description: '',
    seoTitle: '',

    createdAt: now,
    updatedAt: now,
  };

  // Build field metadata — mark what was auto-populated vs empty
  const autoFilledKeys: ListingFieldKey[] = [
    'headline',
    'aduType',
    'address',
    'city',
    'state',
    'zipCode',
    'neighborhood',
    'apn',
    'sqft',
    'permitStatus',
    'certificateOfOccupancy',
    'zoningDesignation',
    'legalRentalStatus',
    'hoaRestrictions',
    'shortTermRentalAllowed',
    'monthlyRent',
    'capRate',
    'grossYield',
    'paybackPeriod',
    'constructionCost',
  ];

  const calculatedKeys: ListingFieldKey[] = ['securityDeposit'];

  if (constructionStatus) autoFilledKeys.push('constructionStatus');

  const fieldMeta: ListingFieldMeta = {};

  for (const key of autoFilledKeys) {
    fieldMeta[key] = autoMeta();
  }
  for (const key of calculatedKeys) {
    fieldMeta[key] = calcMeta();
  }

  // Mark all other keys as empty
  const allKeys = Object.keys(listing) as ListingFieldKey[];
  for (const key of allKeys) {
    if (!fieldMeta[key]) {
      fieldMeta[key] = emptyMeta();
    }
  }

  // Non-editable/meta fields — remove them from tracking
  const metaKeys: ListingFieldKey[] = ['id', 'status', 'createdAt', 'updatedAt', 'lat', 'lng'];
  for (const key of metaKeys) {
    delete fieldMeta[key];
  }

  return { listing, fieldMeta };
}

// ── Mock ProjectState for demo ──

export const MOCK_PROJECT_STATE: ProjectState = {
  step1: {
    address: '2847 Sandburg Way',
    city: 'Irvine',
    state: 'CA',
    zipCode: '92612',
    neighborhood: 'Woodbridge',
    apn: '449-261-08',
    lat: 33.6846,
    lng: -117.8265,
  },
  step2: {
    lotSqft: 7200,
    buildableSqft: 2100,
    maxAduSqft: 520,
    setbacks: '5ft rear, 4ft sides',
    zoningDesignation: 'R-1 Single Family Residential',
    satelliteImageUrl: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=640',
    overlayImageUrl: 'https://images.unsplash.com/photo-1524813686514-a57563d77965?w=640',
    spatialEligibility: true,
  },
  step3: {
    permitStatus: 'verified',
    certificateOfOccupancy: true,
    legalRentalStatus: true,
    hoaRestrictions: 'No HOA restrictions on ADU construction',
    shortTermRentalAllowed: false,
    criteriaPassed: 8,
    criteriaTotal: 9,
    isOwner: true,
    hasHoa: false,
    intendedUse: 'rental',
    aduTypePreference: 'detached',
    budgetRange: '$150K – $250K',
    timeline: 'Recently completed',
  },
  step4: {
    monthlyRentEstimate: 2600,
    constructionCostLow: 165000,
    constructionCostMid: 195000,
    constructionCostHigh: 240000,
    capRate: 5.2,
    grossYield: 15.2,
    paybackPeriodYears: 6.3,
  },
};
