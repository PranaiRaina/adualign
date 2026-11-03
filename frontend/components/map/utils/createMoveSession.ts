import type { InteractionMode, Point2D } from '../types';

type LngLat = { lng: number; lat: number };

interface PointerProjection {
  startCenterPx: Point2D;
  axisWidth: Point2D;
  axisHeight: Point2D;
  startU: number;
  startV: number;
}

interface CreateMoveSessionArgs {
  mousePx: Point2D;
  aduCenter: LngLat;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  projection: PointerProjection;
}

export function createMoveSession({
  mousePx,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduRotation,
  projection,
}: CreateMoveSessionArgs) {
  return {
    mode: 'moving' as InteractionMode,
    startMousePx: mousePx,
    startCenter: aduCenter,
    startSize: aduSize,
    startAspectRatio: aduAspectRatio,
    startRotation: aduRotation,
    startCenterPx: projection.startCenterPx,
    axisWidth: projection.axisWidth,
    axisHeight: projection.axisHeight,
    startU: projection.startU,
    startV: projection.startV,
    anchorU: 0,
    anchorV: 0,
  };
}
