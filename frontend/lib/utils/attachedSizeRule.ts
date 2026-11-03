// CA attached-ADU size rule (Gov. Code §66321/66323): capped at 50% of the
// primary home's livable area, but up to 800 sqft is always allowed.
// Advisory only — nothing in the app hard-caps on this.

export const ATTACHED_BASE_ALLOWANCE_SQFT = 800;

export type AttachedSizeStatus =
  | 'not-applicable' // not an attached ADU, or no size set yet
  | 'ok-under-800'
  | 'ok-under-half'
  | 'over-half'
  | 'unknown-home';

export function getAttachedSizeStatus(args: {
  aduType?: string | null;
  aduSize?: number;
  homeSqft?: number | null;
}): AttachedSizeStatus {
  const { aduType, aduSize, homeSqft } = args;
  if (aduType !== 'attached' || !aduSize) return 'not-applicable';
  if (aduSize <= ATTACHED_BASE_ALLOWANCE_SQFT) return 'ok-under-800';
  if (homeSqft == null) return 'unknown-home';
  return aduSize <= homeSqft / 2 ? 'ok-under-half' : 'over-half';
}
