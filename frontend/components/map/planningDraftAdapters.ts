import type { AduClearance, AnalyzeResponse, PropertyContext } from '@/types';
import { MAP_SNAPSHOT_VERSION, type MapSnapshot } from '@/lib/planningDraft';

import { cloneLegDimensions } from './mapSessionBootstrap';
import type { AduState, MapLocation, ShapeType } from './types';
import type { AduBboxDimensions } from './utils/aduDimensions';

export function buildMapSnapshot({
  adu,
  aduShapeType,
  disabledBuildings,
  frontEdgeSelectionPoint,
  result,
  selectedLocation,
}: {
  adu: AduState;
  aduShapeType: ShapeType;
  disabledBuildings: Set<number>;
  frontEdgeSelectionPoint: { lng: number; lat: number } | null;
  result: AnalyzeResponse | null;
  selectedLocation: MapLocation | null;
}): MapSnapshot | null {
  if (!selectedLocation) {
    return null;
  }

  return {
    version: MAP_SNAPSHOT_VERSION,
    selectedLocation: {
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
      name: selectedLocation.name,
    },
    parcelContext: {
      address: result?.parcel_address ?? selectedLocation.name ?? null,
      apn: result?.apn ?? null,
      county: result?.county ?? null,
    },
    adu: {
      center: adu.center ? { lat: adu.center.lat, lng: adu.center.lng } : null,
      size: adu.size,
      aspectRatio: adu.aspectRatio,
      rotation: adu.rotation,
      shapeType: aduShapeType,
      type: adu.type,
      legDimensions: cloneLegDimensions(adu.legDimensions),
    },
    frontEdgeSelectionPoint: frontEdgeSelectionPoint
      ? {
          lat: frontEdgeSelectionPoint.lat,
          lng: frontEdgeSelectionPoint.lng,
        }
      : null,
    disabledBuildingIndices: Array.from(disabledBuildings).sort((left, right) => left - right),
  };
}

export function buildPlanningDraftPropertyContext({
  aduBboxDimensions,
  aduClearances,
  aduShapeType,
  aduSize,
  aduType,
  currentYardZone,
  initialPlanningContext,
  result,
  selectedLocation,
}: {
  aduBboxDimensions: AduBboxDimensions | null;
  aduClearances: AduClearance[];
  aduShapeType: string;
  aduSize: number;
  aduType: 'detached' | 'attached';
  currentYardZone?: string;
  initialPlanningContext?: PropertyContext | null;
  result: AnalyzeResponse | null;
  selectedLocation: MapLocation | null;
}): PropertyContext | null {
  if (!selectedLocation && !result) {
    return null;
  }

  return {
    fromMap: true,
    address: selectedLocation?.name ?? result?.parcel_address ?? undefined,
    county: result?.county ?? undefined,
    lat: selectedLocation?.lat ?? undefined,
    lng: selectedLocation?.lng ?? undefined,
    aduType,
    aduSize,
    aduWidthFt: aduBboxDimensions?.widthFt,
    aduLengthFt: aduBboxDimensions?.lengthFt,
    aduShape: aduShapeType,
    setback: result?.setback_ft ?? undefined,
    propertyArea: result?.property_area_sqft ?? undefined,
    homeSqft: result?.home_sqft ?? undefined,
    buildableArea: result?.buildable_area_sqft ?? undefined,
    maxAduSqft: result?.max_adu_sqft ?? undefined,
    apn: result?.apn ?? undefined,
    fireHazardSeverity:
      initialPlanningContext?.fireHazardSeverity ?? result?.fire_hazard?.severity ?? undefined,
    fireHazardZoneType:
      initialPlanningContext?.fireHazardZoneType ?? result?.fire_hazard?.zone_type ?? undefined,
    currentYardZone: currentYardZone && currentYardZone !== 'Unknown' ? currentYardZone : undefined,
    aduClearances: aduClearances.length > 0 ? aduClearances : undefined,
  };
}
