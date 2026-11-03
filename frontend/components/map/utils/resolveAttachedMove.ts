import { clamp } from './geometry';

type LngLat = { lng: number; lat: number };

type AttachedDragBounds = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
} | null;

interface ResolveAttachedMoveArgs {
  candidate: LngLat;
  attachedDragBounds: AttachedDragBounds;
}

export function resolveAttachedMove({
  candidate,
  attachedDragBounds,
}: ResolveAttachedMoveArgs): LngLat {
  if (!attachedDragBounds) {
    return candidate;
  }

  return {
    lng: clamp(candidate.lng, attachedDragBounds.minLng, attachedDragBounds.maxLng),
    lat: clamp(candidate.lat, attachedDragBounds.minLat, attachedDragBounds.maxLat),
  };
}
