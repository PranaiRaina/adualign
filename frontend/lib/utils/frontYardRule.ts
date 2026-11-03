// CA's statewide exemption protects ADUs up to 800 sqft from placement
// denial; larger front-yard units are at local discretion. Advisory only.

export const FRONT_YARD_PROTECTED_SQFT = 800;

export function isFrontYardOver800(args: {
  currentZone?: string | null;
  aduSize?: number;
}): boolean {
  const { currentZone, aduSize } = args;
  if (!currentZone || !aduSize) return false;
  // Zone strings are 'Front' | 'Side' | 'Rear' or joins like 'Front / Side';
  // a straddling placement still puts part of the unit in the front yard.
  return currentZone.includes('Front') && aduSize > FRONT_YARD_PROTECTED_SQFT;
}
