import { getAttachedSizeStatus } from '@/lib/utils/attachedSizeRule';
import { isFrontYardOver800 } from '@/lib/utils/frontYardRule';

export interface AdvisoryWarning {
  id: string;
  message: string;
}

// Non-blocking advisories shown in the map's AdvisoryChip. Future warnings
// append entries here.
export function buildAdvisoryWarnings(args: {
  aduType?: string | null;
  aduSize?: number;
  homeSqft?: number | null;
  currentZone?: string | null;
}): AdvisoryWarning[] {
  const warnings: AdvisoryWarning[] = [];

  const sizeStatus = getAttachedSizeStatus(args);
  if (sizeStatus === 'over-half') {
    warnings.push({
      id: 'attached-size-ratio',
      message:
        'CA caps attached ADUs over 800 ft² at 50% of living area. This size may exceed that for your home, so verify with your city.',
    });
  } else if (sizeStatus === 'unknown-home') {
    warnings.push({
      id: 'attached-size-ratio',
      message:
        "CA caps attached ADUs over 800 ft² at 50% of living area. We couldn't verify your home's size, so check with your city.",
    });
  }

  if (isFrontYardOver800({ currentZone: args.currentZone, aduSize: args.aduSize })) {
    warnings.push({
      id: 'front-yard-size',
      message:
        'CA protects front yard ADUs only up to 800 ft². Larger units there depend on local rules, so verify with your city.',
    });
  }

  return warnings;
}
