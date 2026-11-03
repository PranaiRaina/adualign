import type { AduAction, LegDimensions, Point2D, ShapeType } from '../types';
import type { InteractionSession } from './interactionEngineTypes';
import { ORIENTATION_MAX, ORIENTATION_MIN } from '../constants';
import { clamp, generateAduPolygon } from './geometry';
import { isPolygonWithinZone } from './polygonContainment';

interface HandleRotateInteractionArgs {
  active: InteractionSession;
  mousePx: Point2D;
  aduCenter: { lng: number; lat: number } | null;
  aduSize: number;
  aduAspectRatio: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  dispatch: (action: AduAction) => void;
}

export function handleRotateInteraction({
  active,
  mousePx,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduShapeType,
  currentLegDimensions,
  movementBoundary,
  dispatch,
}: HandleRotateInteractionArgs) {
  const currentAngle = Math.atan2(
    mousePx.y - active.startCenterPx.y,
    mousePx.x - active.startCenterPx.x,
  );
  const deltaDeg = (currentAngle - (active.rotationStartAngle || 0)) * (180 / Math.PI);
  const wrappedRotation = (((active.startRotation + deltaDeg) % 360) + 360) % 360;
  const nextRotation = clamp(wrappedRotation, ORIENTATION_MIN, ORIENTATION_MAX);

  if (!aduCenter) {
    return;
  }

  const rotatedPoly = generateAduPolygon(
    aduCenter,
    aduSize,
    aduAspectRatio,
    nextRotation,
    aduShapeType,
    currentLegDimensions,
  );

  if (
    !movementBoundary ||
    (rotatedPoly && isPolygonWithinZone(movementBoundary, rotatedPoly as any))
  ) {
    dispatch({ type: 'SET_ROTATION', rotation: nextRotation });
  }
}
