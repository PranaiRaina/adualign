import { ListingFieldKey } from '../types/listing';
import { formatSqft } from '../utils/formatting';

export interface AgentMessage {
  id: string;
  role: 'agent' | 'user';
  content: string;
  timestamp: number;
}

export function getOpeningMessage(
  autoFilledCount: number,
  requiredMissingCount: number,
  optionalCount: number,
): string {
  return `Your listing draft is ready. Here's where things stand:

✅ Auto-filled from your analysis: ${autoFilledCount} fields
⚠️  Still needed to publish: ${requiredMissingCount} required fields
💡 Recommended additions: ${optionalCount} optional fields that significantly increase buyer interest

Let's get the required fields done first. What type of ADU are you building — detached backyard unit or garage conversion? Your satellite analysis showed space for both.`;
}

export const FIELD_PROMPTS: Record<string, string> = {
  // Required fields
  heroImage: 'Add at least one photo of your ADU. Listings with photos get 8× more inquiries.',
  bedrooms: 'How many bedrooms will the ADU have?',
  bathrooms: 'Full bathroom or ¾ bath?',
  privateEntrance: 'Does it have its own entrance separate from the main house?',
  kitchenType: 'Full kitchen with oven, or kitchenette with cooktop only?',
  inUnitLaundry: 'Washer/dryer included, hookups only, or shared laundry?',
  leaseTerm: "What's your preferred lease length — month-to-month or 1-year?",
  utilitiesStrategy: 'Are utilities separate, shared with main house, or included in rent?',
  contactPreference: 'How should interested renters reach you?',

  // Optional fields
  parkingDetails: 'Does the unit come with parking? This is a top filter for Irvine renters.',
  outdoorSpace: 'Any private patio or yard access? Even small outdoor space adds value.',
  climateControl: 'Mini-split, central AC, or window units? Renters ask about this.',
  furnished: 'Unfurnished, partially, or fully furnished?',
  proximityToEmployers:
    'Near UCI, Irvine Spectrum, or other major employers? Mention it — it drives search traffic.',
};

export function getFieldConfirmation(fieldKey: string): string {
  return `Got it — added to your listing.`;
}

export function getPricingAdvice(
  monthlyRent: number,
  bedrooms: string,
  aduType: string,
  city: string,
): string {
  const low = Math.round((monthlyRent * 0.92) / 100) * 100;
  const high = Math.round((monthlyRent * 1.08) / 100) * 100;
  return `Based on your analysis, $${monthlyRent.toLocaleString()}/mo is the expected market rate for a ${bedrooms}-bed ${aduType} ADU in ${city}. Your verified permit status justifies the higher end of the $${low.toLocaleString()}–$${high.toLocaleString()} range.`;
}

export function getPublishReadyMessage(
  monthlyRent: number,
  bedrooms: number | null,
  bathrooms: number | null,
  sqft: number | null,
  aduType: string,
  neighborhood: string,
): string {
  const sqftText = sqft !== null && sqft !== undefined ? formatSqft(sqft) : '?';

  return `Your listing is ready to publish. Here's a summary:

✅ All 9 required fields complete
📸 Hero image added
💰 $${(monthlyRent || 0).toLocaleString()}/mo · ${bedrooms || '?'} bed · ${bathrooms || '?'} bath · ${sqftText}
🏠 ${aduType || 'ADU'} · Verified permit
📍 ${neighborhood}

Optional upgrades still available:
[+ Add parking details] [+ Add investor metrics] [+ Add neighborhood scores]

Ready to go live? Hit Publish.`;
}

export const QUICK_ACTIONS = [
  { id: 'write_description', label: 'Write description' },
  { id: 'improve_headline', label: 'Improve headline' },
  { id: 'add_investor', label: 'Add investor section' },
  { id: 'suggest_price', label: 'Suggest rent price' },
  { id: 'complete_fields', label: 'Complete missing fields' },
  { id: 'preview', label: 'Preview listing' },
] as const;

export type QuickActionId = (typeof QUICK_ACTIONS)[number]['id'];

function getSqftText(sqft?: number | null): string {
  if (sqft === null || sqft === undefined) return '';
  return formatSqft(sqft);
}

function getSqftPrefix(sqft?: number | null): string {
  const sqftText = getSqftText(sqft);
  return sqftText ? `${sqftText} ` : '';
}

export function getQuickActionResponse(
  actionId: QuickActionId,
  context: {
    monthlyRent?: number;
    aduType?: string;
    city?: string;
    neighborhood?: string;
    sqft?: number;
    permitStatus?: string;
  },
): string {
  switch (actionId) {
    case 'write_description':
      return generateListingDescription(context);
    case 'improve_headline':
      return `Here are a few headline options:

1. "Permitted ${context.aduType || 'Detached'} ADU in ${context.neighborhood || context.city || 'Irvine'} — Private Entrance + Full Kitchen — $${(context.monthlyRent || 0).toLocaleString()}/mo"
2. "Move-In Ready ${getSqftPrefix(context.sqft)}${context.aduType || ''} ADU — ${context.neighborhood || ''}, ${context.city || 'Irvine'}"
3. "Verified Permit · ${context.aduType || 'Detached'} ADU · ${context.neighborhood || context.city || 'Irvine'}"

Which one works best? I can tweak any of them.`;
    case 'suggest_price':
      return getPricingAdvice(
        context.monthlyRent || 2600,
        '1',
        context.aduType || 'detached',
        context.city || 'Irvine',
      );
    case 'add_investor':
      return `I'll add an investor metrics section with your financial data:

• Cap Rate: ${context.monthlyRent ? '5.2%' : 'N/A'}
• Gross Yield: 15.2%
• Payback Period: 6.3 years
• Monthly Cash Flow: $${(context.monthlyRent || 0).toLocaleString()}

Added to your listing under "Investor Metrics."`;
    case 'complete_fields':
      return `Let me walk you through the remaining fields one by one. Starting with the most impactful ones first.`;
    case 'preview':
      return `Opening preview mode... Your listing looks great so far! Check the canvas on the left for the full preview.`;
    default:
      return '';
  }
}

function generateListingDescription(context: {
  monthlyRent?: number;
  aduType?: string;
  city?: string;
  neighborhood?: string;
  sqft?: number;
  permitStatus?: string;
}): string {
  const aduLabel =
    context.aduType === 'detached'
      ? 'detached ADU'
      : context.aduType === 'garage_conversion'
        ? 'garage conversion ADU'
        : context.aduType || 'ADU';

  return `Here's a draft description based on your wizard data:

"Permitted and finaled, this ${aduLabel} sits at the rear of a ${context.neighborhood || ''} lot with its own gated entrance. The ${getSqftText(context.sqft)} layout includes a full kitchen with stainless appliances and vaulted ceilings that make the space feel larger than the square footage suggests.

Private entrance ensures complete separation from the main house. Located in ${context.neighborhood || context.city || 'Irvine'}, minutes from major employers and shopping.

At $${(context.monthlyRent || 0).toLocaleString()}/mo with a verified permit, this unit represents a strong rental opportunity."

Want me to adjust the tone or add specific features?`;
}
