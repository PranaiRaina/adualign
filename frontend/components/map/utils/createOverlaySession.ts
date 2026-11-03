import type { Point2D, LegDimensions } from '../types';
import { dot, fromTo } from './geometry';
import type { OverlayHit, SelectedOverlayGeometry } from './interactionEngineTypes';
import { resolveOverlayAnchors } from './resolveOverlayAnchors';

type LngLat = { lng: number; lat: number };

interface CreateOverlaySessionArgs {
  mousePx: Point2D;
  overlayHit: OverlayHit;
  selectedOverlayGeometry: Pick<
    SelectedOverlayGeometry,
    'centerPx' | 'axisWidth' | 'axisHeight' | 'minU' | 'maxU' | 'minV' | 'maxV'
  >;
  aduCenter: LngLat;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
}

export function createOverlaySession({
  mousePx,
  overlayHit,
  selectedOverlayGeometry,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduRotation,
  currentLegDimensions,
}: CreateOverlaySessionArgs) {
  const centerPx = selectedOverlayGeometry.centerPx;
  const mouseDelta = fromTo(centerPx, mousePx);
  const startU = dot(mouseDelta, selectedOverlayGeometry.axisWidth);
  const startV = dot(mouseDelta, selectedOverlayGeometry.axisHeight);
  const { anchorU, anchorV } = resolveOverlayAnchors({
    overlayHit,
    selectedOverlayGeometry,
  });

  return {
    mode: overlayHit.mode,
    startMousePx: mousePx,
    startCenter: aduCenter,
    startSize: aduSize,
    startAspectRatio: aduAspectRatio,
    startRotation: aduRotation,
    startCenterPx: selectedOverlayGeometry.centerPx,
    axisWidth: selectedOverlayGeometry.axisWidth,
    axisHeight: selectedOverlayGeometry.axisHeight,
    startU,
    startV,
    anchorU,
    anchorV,
    cornerId: overlayHit.cornerId,
    edgeId: overlayHit.edgeId,
    rotationStartAngle: Math.atan2(mousePx.y - centerPx.y, mousePx.x - centerPx.x),
    legIndex: overlayHit.legIndex,
    startLegDimensions: currentLegDimensions,
  };
}
