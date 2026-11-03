import type { ShapeType, LegDimensions } from '../types';
import { generateAduPolygon } from './geometry';
import { isPolygonWithinZone } from './polygonContainment';

type LngLat = { lng: number; lat: number };

interface ResolveDetachedMoveArgs {
  candidate: LngLat;
  aduCenter: LngLat;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
}

export function resolveDetachedMove({
  candidate,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduRotation,
  aduShapeType,
  currentLegDimensions,
  movementBoundary,
}: ResolveDetachedMoveArgs): LngLat {
  const deltaLng = candidate.lng - aduCenter.lng;
  const deltaLat = candidate.lat - aduCenter.lat;

  let nextLng = aduCenter.lng;
  let nextLat = aduCenter.lat;

  if (!movementBoundary) {
    return {
      lng: aduCenter.lng + deltaLng,
      lat: aduCenter.lat + deltaLat,
    };
  }

  const nextPolyLng = generateAduPolygon(
    {
      lng: aduCenter.lng + deltaLng,
      lat: aduCenter.lat,
    },
    aduSize,
    aduAspectRatio,
    aduRotation,
    aduShapeType,
    currentLegDimensions,
  );
  if (nextPolyLng && isPolygonWithinZone(movementBoundary, nextPolyLng as any)) {
    nextLng = aduCenter.lng + deltaLng;
  }

  const nextPolyLat = generateAduPolygon(
    { lng: nextLng, lat: aduCenter.lat + deltaLat },
    aduSize,
    aduAspectRatio,
    aduRotation,
    aduShapeType,
    currentLegDimensions,
  );
  if (nextPolyLat && isPolygonWithinZone(movementBoundary, nextPolyLat as any)) {
    nextLat = aduCenter.lat + deltaLat;
  }

  return { lng: nextLng, lat: nextLat };
}
