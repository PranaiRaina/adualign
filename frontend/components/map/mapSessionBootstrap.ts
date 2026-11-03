import type { PropertyContext } from '@/types';
import type { MapSnapshot } from '@/lib/planningDraft';

import { ADU_INITIAL_STATE } from './aduReducer';
import type { AduState, MapLocation, ShapeType } from './types';

export type MapSessionState = {
  isFromChat: boolean;
  projectId?: string | null;
  resumeAddress?: string;
  mapSearchId?: string;
};

export function createMapSessionState({
  initialAddress,
  isFromChat,
  projectId,
  mapSearchId,
}: {
  initialAddress?: string;
  isFromChat: boolean;
  projectId?: string | null;
  mapSearchId?: string;
}): MapSessionState {
  return {
    isFromChat,
    projectId,
    resumeAddress: isFromChat ? initialAddress : undefined,
    mapSearchId,
  };
}

export function buildStandaloneMapUrl(location?: MapLocation | null, mapSearchId?: string) {
  if (!location) {
    return '/map';
  }

  const params = new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
    name: location.name,
  });
  if (mapSearchId) {
    params.set('mapSearchId', mapSearchId);
  }

  return `/map?${params.toString()}`;
}

export function resolveInitialPlanningContext(
  initialPlanningContext: PropertyContext | undefined,
  draftPropertyContext: PropertyContext | null,
  draftMapSnapshot: MapSnapshot | null,
): PropertyContext | undefined {
  if (initialPlanningContext) {
    return initialPlanningContext;
  }

  if (draftPropertyContext) {
    return draftPropertyContext;
  }

  if (!draftMapSnapshot) {
    return undefined;
  }

  return {
    fromMap: true,
    address: draftMapSnapshot.parcelContext.address ?? draftMapSnapshot.selectedLocation.name,
    county: draftMapSnapshot.parcelContext.county ?? undefined,
    lat: draftMapSnapshot.selectedLocation.lat,
    lng: draftMapSnapshot.selectedLocation.lng,
    aduType: draftMapSnapshot.adu.type,
    aduSize: draftMapSnapshot.adu.size,
    aduShape: draftMapSnapshot.adu.shapeType,
    apn: draftMapSnapshot.parcelContext.apn ?? undefined,
  };
}

export function getInitialMapAduShapeType(context: PropertyContext | undefined): ShapeType {
  return isShapeType(context?.aduShape) ? context.aduShape : 'rectangle';
}

export function buildInitialAduState(
  context: PropertyContext | undefined,
  mapSnapshot?: MapSnapshot | null,
): AduState {
  if (mapSnapshot) {
    return {
      ...ADU_INITIAL_STATE,
      size: mapSnapshot.adu.size,
      aspectRatio: mapSnapshot.adu.aspectRatio,
      rotation: mapSnapshot.adu.rotation,
      type: mapSnapshot.adu.type,
      legDimensions: cloneLegDimensions(mapSnapshot.adu.legDimensions),
    };
  }

  return {
    ...ADU_INITIAL_STATE,
    size: context?.aduSize ?? ADU_INITIAL_STATE.size,
    type: getInitialMapAduType(context),
  };
}

export function buildInitialLocationFromMapSnapshot(
  mapSnapshot: MapSnapshot | null,
): MapLocation | undefined {
  return mapSnapshot?.selectedLocation ?? undefined;
}

function getInitialMapAduType(context: PropertyContext | undefined): 'detached' | 'attached' {
  return context?.aduType === 'attached' ? 'attached' : 'detached';
}

function isShapeType(value: string | undefined): value is ShapeType {
  return value === 'rectangle' || value === 'l-shape' || value === 't-shape' || value === 'u-shape';
}

export function cloneLegDimensions(legDimensions: AduState['legDimensions']) {
  return {
    'l-shape': { ...legDimensions['l-shape'] },
    't-shape': { ...legDimensions['t-shape'] },
    'u-shape': { ...legDimensions['u-shape'] },
  };
}
