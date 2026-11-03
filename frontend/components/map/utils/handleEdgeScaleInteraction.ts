import type { Map as MapboxMap } from 'mapbox-gl';

import type { AduAction, LegDimensions, ShapeType } from '../types';
import type { InteractionSession } from './interactionEngineTypes';
import { FLOOR_AREA_MIN, ASPECT_RATIO_MIN, ASPECT_RATIO_MAX, SCALE_MIN_FACTOR } from '../constants';
import { clamp, generateAduPolygon } from './geometry';
import { isPolygonWithinZone } from './polygonContainment';

interface HandleEdgeScaleInteractionArgs {
  active: InteractionSession;
  map: MapboxMap;
  u: number;
  v: number;
  aduMaxArea: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: (action: AduAction) => void;
}

export function handleEdgeScaleInteraction({
  active,
  map,
  u,
  v,
  aduMaxArea,
  aduShapeType,
  currentLegDimensions,
  movementBoundary,
  dispatchCenter,
  dispatch,
}: HandleEdgeScaleInteractionArgs) {
  const isVertical = active.edgeId === 'top' || active.edgeId === 'bottom';
  const denominator = isVertical
    ? Math.abs(active.startV - active.anchorV) || 1
    : Math.abs(active.startU - active.anchorU) || 1;
  const numerator = isVertical ? Math.abs(v - active.anchorV) : Math.abs(u - active.anchorU);
  const rawStretch = Math.max(SCALE_MIN_FACTOR, numerator / denominator);
  const sizeMinStretch = FLOOR_AREA_MIN / active.startSize;
  const sizeMaxStretch = aduMaxArea / active.startSize;
  const aspectMinStretch = isVertical
    ? active.startAspectRatio / ASPECT_RATIO_MAX
    : ASPECT_RATIO_MIN / active.startAspectRatio;
  const aspectMaxStretch = isVertical
    ? active.startAspectRatio / ASPECT_RATIO_MIN
    : ASPECT_RATIO_MAX / active.startAspectRatio;
  const stretch = clamp(
    rawStretch,
    Math.max(sizeMinStretch, aspectMinStretch),
    Math.min(sizeMaxStretch, aspectMaxStretch),
  );
  const nextSize = active.startSize * stretch;
  const committedSize = Math.round(nextSize);
  const nextAspect = isVertical
    ? active.startAspectRatio / stretch
    : active.startAspectRatio * stretch;
  const centerU = isVertical ? 0 : active.anchorU * (1 - stretch);
  const centerV = isVertical ? active.anchorV * (1 - stretch) : 0;
  const nextCenterPx = {
    x: active.startCenterPx.x + active.axisWidth.x * centerU + active.axisHeight.x * centerV,
    y: active.startCenterPx.y + active.axisWidth.y * centerU + active.axisHeight.y * centerV,
  };
  const nextLngLat = map.unproject([nextCenterPx.x, nextCenterPx.y]);
  const nextPoly = generateAduPolygon(
    { lng: nextLngLat.lng, lat: nextLngLat.lat },
    committedSize,
    nextAspect,
    active.startRotation,
    aduShapeType,
    currentLegDimensions,
  );

  if (!movementBoundary || (nextPoly && isPolygonWithinZone(movementBoundary, nextPoly as any))) {
    dispatchCenter({ lng: nextLngLat.lng, lat: nextLngLat.lat });
    dispatch({ type: 'SET_SIZE', size: committedSize });
    dispatch({ type: 'SET_ASPECT_RATIO', aspectRatio: nextAspect });
  }
}
