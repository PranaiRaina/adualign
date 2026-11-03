import {
  CORNER_HANDLE_HIT_RADIUS,
  ROTATE_HANDLE_HIT_RADIUS,
  EDGE_HANDLE_HIT_HALF_W,
  EDGE_HANDLE_HIT_HALF_H,
  LEG_HANDLE_HIT_RADIUS,
  HIT_TEST_TOLERANCE_PX,
} from '../constants';
import type { Point2D } from '../types';
import { pointInPolygon2D } from './geometry';
import type { OverlayHit, SelectedOverlayGeometry } from './interactionEngineTypes';

function getDistanceBetweenPoints(a: Point2D, b: Point2D) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function detectOverlayHit({
  mousePx,
  selectedOverlayGeometry,
}: {
  mousePx: Point2D;
  selectedOverlayGeometry: SelectedOverlayGeometry;
}): OverlayHit | null {
  const hitRotation =
    getDistanceBetweenPoints(mousePx, selectedOverlayGeometry.rotationHandle) <=
    ROTATE_HANDLE_HIT_RADIUS + HIT_TEST_TOLERANCE_PX;

  let hitCorner: OverlayHit['cornerId'] | null = null;
  if (!hitRotation) {
    for (const cornerId of ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const) {
      if (
        getDistanceBetweenPoints(mousePx, selectedOverlayGeometry.corners[cornerId]) <=
        CORNER_HANDLE_HIT_RADIUS + HIT_TEST_TOLERANCE_PX
      ) {
        hitCorner = cornerId;
        break;
      }
    }
  }

  let hitEdge: OverlayHit['edgeId'] | null = null;
  if (!hitRotation && !hitCorner) {
    for (const edgeId of ['top', 'right', 'bottom', 'left'] as const) {
      const edgeHandle = selectedOverlayGeometry.edgeHandles[edgeId];
      if (
        Math.abs(mousePx.x - edgeHandle.x) <= EDGE_HANDLE_HIT_HALF_W + HIT_TEST_TOLERANCE_PX &&
        Math.abs(mousePx.y - edgeHandle.y) <= EDGE_HANDLE_HIT_HALF_H + HIT_TEST_TOLERANCE_PX
      ) {
        hitEdge = edgeId;
        break;
      }
    }
  }

  let hitLegIndex: number | null = null;
  if (!hitRotation && !hitCorner && !hitEdge && selectedOverlayGeometry.legHandles.length > 0) {
    for (const legHandle of selectedOverlayGeometry.legHandles) {
      if (getDistanceBetweenPoints(mousePx, legHandle) <= LEG_HANDLE_HIT_RADIUS) {
        hitLegIndex = legHandle.legIndex;
        break;
      }
    }
  }

  const bboxPoints = [
    selectedOverlayGeometry.corners['top-left'],
    selectedOverlayGeometry.corners['top-right'],
    selectedOverlayGeometry.corners['bottom-right'],
    selectedOverlayGeometry.corners['bottom-left'],
  ];
  const hitBody =
    !hitRotation &&
    !hitCorner &&
    !hitEdge &&
    hitLegIndex === null &&
    pointInPolygon2D(mousePx, bboxPoints);

  if (!hitRotation && !hitCorner && !hitEdge && hitLegIndex === null && !hitBody) {
    return null;
  }

  return {
    mode: hitRotation
      ? 'rotating'
      : hitCorner
        ? 'scaling-corner'
        : hitEdge
          ? 'scaling-edge'
          : hitLegIndex !== null
            ? 'reshaping-leg'
            : 'moving',
    cornerId: hitCorner ?? undefined,
    edgeId: hitEdge ?? undefined,
    legIndex: hitLegIndex ?? undefined,
  };
}
