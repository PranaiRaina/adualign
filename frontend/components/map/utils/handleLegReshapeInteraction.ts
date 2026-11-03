import type { AduAction, LegDimensions, ShapeType } from '../types';
import type { InteractionSession, SelectedOverlayGeometry } from './interactionEngineTypes';
import { FLOOR_AREA_MIN, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX } from '../constants';
import { clamp, generateAduPolygon, getShapeAreaRatio } from './geometry';
import { isPolygonWithinZone } from './polygonContainment';

interface HandleLegReshapeInteractionArgs {
  active: InteractionSession;
  u: number;
  v: number;
  aduCenter: { lng: number; lat: number } | null;
  aduMaxArea: number;
  aduShapeType: ShapeType;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  selectedOverlayGeometry: SelectedOverlayGeometry | null;
  dispatch: (action: AduAction) => void;
}

export function handleLegReshapeInteraction({
  active,
  u,
  v,
  aduCenter,
  aduMaxArea,
  aduShapeType,
  movementBoundary,
  selectedOverlayGeometry,
  dispatch,
}: HandleLegReshapeInteractionArgs) {
  if (!aduCenter || aduShapeType === 'rectangle') {
    return;
  }

  const aduTypeVal = aduShapeType as 'l-shape' | 't-shape' | 'u-shape';
  const obbRangeU = (selectedOverlayGeometry?.maxU ?? 1) - (selectedOverlayGeometry?.minU ?? 0);
  const obbRangeV = (selectedOverlayGeometry?.maxV ?? 1) - (selectedOverlayGeometry?.minV ?? 0);
  const normalizedU = obbRangeU > 0 ? (u - (selectedOverlayGeometry?.minU ?? 0)) / obbRangeU : 0.5;
  const normalizedV = obbRangeV > 0 ? (v - (selectedOverlayGeometry?.minV ?? 0)) / obbRangeV : 0.5;
  const startDims = active.startLegDimensions as LegDimensions[typeof aduTypeVal];
  const newLegDims = { ...startDims } as any;

  if (aduShapeType === 'l-shape') {
    if (active.legIndex === 0) {
      newLegDims.tX = clamp(normalizedU, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX);
    } else if (active.legIndex === 1) {
      newLegDims.tY = clamp(1 - normalizedV, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX);
    }
  } else if (aduShapeType === 't-shape') {
    let newStemWidth = (startDims as LegDimensions['t-shape']).stemWidth ?? 0.5;
    let newCrossbarDepth = (startDims as LegDimensions['t-shape']).crossbarDepth ?? 0.4;
    if (active.legIndex === 0) {
      newStemWidth = clamp(normalizedU * 2 - 1, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX);
    } else if (active.legIndex === 1) {
      newCrossbarDepth = clamp(1 - normalizedV, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX);
    }
    newLegDims.stemWidth = newStemWidth;
    newLegDims.crossbarDepth = newCrossbarDepth;
  } else if (aduShapeType === 'u-shape') {
    if (active.legIndex === 0) {
      newLegDims.cutoutWidth = clamp(1 - normalizedU * 2, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX);
    } else if (active.legIndex === 1) {
      newLegDims.cutoutDepth = clamp(1 - normalizedV, LEG_DIMENSION_MIN, LEG_DIMENSION_MAX);
    }
  }

  const oldRatio = getShapeAreaRatio(aduShapeType, active.startLegDimensions);
  let newRatio = getShapeAreaRatio(aduShapeType, newLegDims);
  let nextSize = active.startSize * (newRatio / oldRatio);

  if (nextSize < FLOOR_AREA_MIN || nextSize > aduMaxArea) {
    nextSize = clamp(nextSize, FLOOR_AREA_MIN, aduMaxArea);
    const targetRatio = oldRatio * (nextSize / active.startSize);

    if (aduShapeType === 'l-shape') {
      if (active.legIndex === 0) {
        newLegDims.tX = clamp(
          (targetRatio - newLegDims.tY) / (1 - newLegDims.tY),
          LEG_DIMENSION_MIN,
          LEG_DIMENSION_MAX,
        );
      } else {
        newLegDims.tY = clamp(
          (targetRatio - newLegDims.tX) / (1 - newLegDims.tX),
          LEG_DIMENSION_MIN,
          LEG_DIMENSION_MAX,
        );
      }
    } else if (aduShapeType === 't-shape') {
      if (active.legIndex === 0) {
        const crossbarDepth = newLegDims.crossbarDepth;
        newLegDims.stemWidth = clamp(
          (targetRatio - crossbarDepth) / (1 - crossbarDepth),
          LEG_DIMENSION_MIN,
          LEG_DIMENSION_MAX,
        );
      } else {
        const stemWidth = newLegDims.stemWidth;
        newLegDims.crossbarDepth = clamp(
          (targetRatio - stemWidth) / (1 - stemWidth),
          LEG_DIMENSION_MIN,
          LEG_DIMENSION_MAX,
        );
      }
    } else if (aduShapeType === 'u-shape') {
      if (active.legIndex === 0) {
        newLegDims.cutoutWidth = clamp(
          (1 - targetRatio) / (1 - newLegDims.cutoutDepth),
          LEG_DIMENSION_MIN,
          LEG_DIMENSION_MAX,
        );
      } else {
        newLegDims.cutoutDepth = clamp(
          1 - (1 - targetRatio) / newLegDims.cutoutWidth,
          LEG_DIMENSION_MIN,
          LEG_DIMENSION_MAX,
        );
      }
    }

    newRatio = getShapeAreaRatio(aduShapeType, newLegDims);
    nextSize = active.startSize * (newRatio / oldRatio);
  }

  const previewPoly = generateAduPolygon(
    aduCenter,
    nextSize,
    active.startAspectRatio,
    active.startRotation,
    aduShapeType,
    newLegDims,
  );

  if (!previewPoly) {
    return;
  }

  if (movementBoundary && !isPolygonWithinZone(movementBoundary, previewPoly as any)) {
    return;
  }

  dispatch({ type: 'SET_LEG_DIMENSIONS', shape: aduTypeVal, dims: newLegDims });
  dispatch({ type: 'SET_SIZE', size: Math.round(nextSize) });
}
