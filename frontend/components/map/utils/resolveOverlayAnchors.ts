import type { SelectedOverlayGeometry, OverlayHit } from './interactionEngineTypes';

export function resolveOverlayAnchors({
  overlayHit,
  selectedOverlayGeometry,
}: {
  overlayHit: OverlayHit;
  selectedOverlayGeometry: Pick<SelectedOverlayGeometry, 'minU' | 'maxU' | 'minV' | 'maxV'>;
}) {
  let anchorU = 0;
  let anchorV = 0;

  if (overlayHit.cornerId) {
    if (overlayHit.cornerId === 'top-left') {
      anchorU = selectedOverlayGeometry.maxU;
      anchorV = selectedOverlayGeometry.minV;
    }
    if (overlayHit.cornerId === 'top-right') {
      anchorU = selectedOverlayGeometry.minU;
      anchorV = selectedOverlayGeometry.minV;
    }
    if (overlayHit.cornerId === 'bottom-right') {
      anchorU = selectedOverlayGeometry.minU;
      anchorV = selectedOverlayGeometry.maxV;
    }
    if (overlayHit.cornerId === 'bottom-left') {
      anchorU = selectedOverlayGeometry.maxU;
      anchorV = selectedOverlayGeometry.maxV;
    }
  }

  if (overlayHit.edgeId) {
    if (overlayHit.edgeId === 'top') {
      anchorV = selectedOverlayGeometry.minV;
    }
    if (overlayHit.edgeId === 'bottom') {
      anchorV = selectedOverlayGeometry.maxV;
    }
    if (overlayHit.edgeId === 'left') {
      anchorU = selectedOverlayGeometry.maxU;
    }
    if (overlayHit.edgeId === 'right') {
      anchorU = selectedOverlayGeometry.minU;
    }
  }

  return { anchorU, anchorV };
}
