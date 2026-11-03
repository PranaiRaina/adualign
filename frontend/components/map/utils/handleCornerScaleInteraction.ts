import type { Map as MapboxMap } from 'mapbox-gl';

import type { AduAction, LegDimensions, ShapeType } from '../types';
import type { InteractionSession } from './interactionEngineTypes';
import { FLOOR_AREA_MIN, SCALE_MIN_FACTOR } from '../constants';
import { clamp, generateAduPolygon } from './geometry';
import { isPolygonWithinZone } from './polygonContainment';

interface HandleCornerScaleInteractionArgs {
  active: InteractionSession;
  map: MapboxMap;
  u: number;
  v: number;
  aduCenter: { lng: number; lat: number } | null;
  aduMaxArea: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: (action: AduAction) => void;
}

export function handleCornerScaleInteraction({
  active,
  map,
  u,
  v,
  aduCenter,
  aduMaxArea,
  aduShapeType,
  currentLegDimensions,
  movementBoundary,
  dispatchCenter,
  dispatch,
}: HandleCornerScaleInteractionArgs) {
  if (!aduCenter) {
    return;
  }

  const startDist = Math.hypot(active.startU - active.anchorU, active.startV - active.anchorV) || 1;
  const currentDist = Math.hypot(u - active.anchorU, v - active.anchorV);
  const rawScale = Math.max(SCALE_MIN_FACTOR, currentDist / startDist);
  const nextSize = clamp(active.startSize * rawScale * rawScale, FLOOR_AREA_MIN, aduMaxArea);
  const committedSize = Math.round(nextSize);
  const appliedScale = Math.sqrt(committedSize / active.startSize);
  const centerU = active.anchorU * (1 - appliedScale);
  const centerV = active.anchorV * (1 - appliedScale);
  const nextCenterPx = {
    x: active.startCenterPx.x + active.axisWidth.x * centerU + active.axisHeight.x * centerV,
    y: active.startCenterPx.y + active.axisWidth.y * centerU + active.axisHeight.y * centerV,
  };
  const nextLngLat = map.unproject([nextCenterPx.x, nextCenterPx.y]);
  const nextPoly = generateAduPolygon(
    { lng: nextLngLat.lng, lat: nextLngLat.lat },
    committedSize,
    active.startAspectRatio,
    active.startRotation,
    aduShapeType,
    currentLegDimensions,
  );

  if (!movementBoundary || (nextPoly && isPolygonWithinZone(movementBoundary, nextPoly as any))) {
    dispatchCenter({ lng: nextLngLat.lng, lat: nextLngLat.lat });
    dispatch({ type: 'SET_SIZE', size: committedSize });
  }
}
