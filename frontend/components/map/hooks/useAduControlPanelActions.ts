import type * as React from 'react';
import { useCallback, useMemo } from 'react';

import {
  ASPECT_RATIO_MAX,
  ASPECT_RATIO_MIN,
  DEFAULT_ADU_ASPECT_RATIO,
  DEFAULT_ADU_SIZE_SQFT,
  DEFAULT_LEG_DIMENSIONS,
  FLOOR_AREA_MIN,
  ORIENTATION_MAX,
  ORIENTATION_MIN,
} from '../constants';
import type {
  AduAction,
  LegDimensions,
  RectangleShapeState,
  ShapeStateCache,
  ShapeType,
  SnapResult,
} from '../types';
import { clamp, generateAduPolygon } from '../utils/geometry';
import { isPolygonWithinZone } from '../utils/polygonContainment';

type AduPlacementCenter = { lng: number; lat: number };

interface UseAduControlPanelActionsParams {
  aduType: 'detached' | 'attached';
  aduCenter: AduPlacementCenter | null;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  aduMaxArea: number;
  shapeStatesRef: React.MutableRefObject<ShapeStateCache>;
  initialRectangleStateRef: React.MutableRefObject<RectangleShapeState | null>;
  dispatch: React.Dispatch<AduAction>;
  dispatchCenter: (center: AduPlacementCenter | null) => void;
  snapToNearestWall: (
    targetLng: number,
    targetLat: number,
    currentAduRotation: number,
    currentAduSize: number,
    currentAduAspectRatio: number,
    currentAduShapeType: ShapeType,
    legDimensions: LegDimensions[keyof LegDimensions] | undefined,
  ) => SnapResult | null;
  snapAttachedPlacement: (options?: {
    center?: AduPlacementCenter;
    rotation?: number;
    size?: number;
    aspectRatio?: number;
    shapeType?: ShapeType;
    legDimensions?: LegDimensions[keyof LegDimensions];
    customPolygon?: GeoJSON.Polygon | null;
    animate?: boolean;
  }) => boolean;
  setAduShapeType: (shape: ShapeType) => void;
  autoEdgeAlign: boolean;
  setAutoEdgeAlign: (value: boolean) => void;
  autoPositionCorrection: boolean;
  setAutoPositionCorrection: (value: boolean) => void;
  showAdvancedSettings: boolean;
  setShowAdvancedSettings: (value: boolean) => void;
}

function canPlaceDetachedShape({
  aduType,
  movementBoundary,
  center,
  size,
  aspectRatio,
  rotation,
  shapeType,
  legDimensions,
}: {
  aduType: 'detached' | 'attached';
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  center: AduPlacementCenter | null;
  size: number;
  aspectRatio: number;
  rotation: number;
  shapeType: ShapeType;
  legDimensions?: LegDimensions[keyof LegDimensions];
}) {
  if (aduType !== 'detached' || !movementBoundary || !center) {
    return true;
  }

  const nextPolygon = generateAduPolygon(
    center,
    size,
    aspectRatio,
    rotation,
    shapeType,
    legDimensions,
  );

  return !nextPolygon || isPolygonWithinZone(movementBoundary, nextPolygon as any);
}

function buildShapeState({
  center,
  size,
  aspectRatio,
  rotation,
  legDimensions,
}: {
  center: AduPlacementCenter;
  size: number;
  aspectRatio: number;
  rotation: number;
  legDimensions?: LegDimensions[keyof LegDimensions];
}) {
  return {
    center,
    size,
    aspectRatio,
    rotation,
    legDimensions,
  };
}

export function useAduControlPanelActions({
  aduType,
  aduCenter,
  aduSize,
  aduAspectRatio,
  aduRotation,
  aduShapeType,
  currentLegDimensions,
  movementBoundary,
  aduMaxArea,
  shapeStatesRef,
  initialRectangleStateRef,
  dispatch,
  dispatchCenter,
  snapToNearestWall,
  snapAttachedPlacement,
  setAduShapeType,
  autoEdgeAlign,
  setAutoEdgeAlign,
  autoPositionCorrection,
  setAutoPositionCorrection,
  showAdvancedSettings,
  setShowAdvancedSettings,
}: UseAduControlPanelActionsParams) {
  const aspectRatioSliderValue = useMemo(
    () => Math.max(1, Math.min(100, ((aduAspectRatio - 0.3) / 2.7) * 99 + 1)),
    [aduAspectRatio],
  );

  const selectAduType = useCallback(
    (nextType: 'detached' | 'attached') => {
      if (aduType === nextType) {
        return;
      }

      if (!aduCenter) {
        return;
      }

      dispatch({ type: 'SET_TYPE', aduType: nextType });

      if (nextType !== 'attached') {
        return;
      }

      const snapped = snapToNearestWall(
        aduCenter.lng,
        aduCenter.lat,
        aduRotation,
        aduSize,
        aduAspectRatio,
        aduShapeType,
        currentLegDimensions,
      );

      if (!snapped) {
        return;
      }

      dispatch({ type: 'SET_ROTATION', rotation: snapped.rotation });
      dispatchCenter({ lng: snapped.lng, lat: snapped.lat });
      dispatch({ type: 'SET_IS_VALID', isValid: snapped.isValid });
    },
    [
      aduAspectRatio,
      aduCenter,
      aduRotation,
      aduShapeType,
      aduSize,
      aduType,
      currentLegDimensions,
      dispatch,
      dispatchCenter,
      snapToNearestWall,
    ],
  );

  const resetCurrentShape = useCallback(() => {
    let nextSize = DEFAULT_ADU_SIZE_SQFT;
    let nextAspectRatio = DEFAULT_ADU_ASPECT_RATIO;
    let nextRotation = 0;
    let nextCenter = aduCenter;
    let nextLegDimensions: LegDimensions[keyof LegDimensions] | undefined;

    if (!nextCenter) {
      return;
    }

    if (aduShapeType === 'rectangle' && initialRectangleStateRef.current) {
      nextSize = initialRectangleStateRef.current.size;
      nextAspectRatio = initialRectangleStateRef.current.aspectRatio;
      nextRotation = initialRectangleStateRef.current.rotation;
      nextCenter = initialRectangleStateRef.current.center;
    }

    if (aduShapeType !== 'rectangle' && shapeStatesRef.current[aduShapeType]) {
      const cachedShape = shapeStatesRef.current[aduShapeType];
      if (cachedShape) {
        nextSize = cachedShape.size;
        nextAspectRatio = cachedShape.aspectRatio;
        nextRotation = cachedShape.rotation;
        nextCenter = cachedShape.center;
        nextLegDimensions = cachedShape.legDimensions;
      }
    }

    if (
      !canPlaceDetachedShape({
        aduType,
        movementBoundary,
        center: nextCenter,
        size: nextSize,
        aspectRatio: nextAspectRatio,
        rotation: nextRotation,
        shapeType: aduShapeType,
        legDimensions: nextLegDimensions,
      })
    ) {
      return;
    }

    dispatch({ type: 'SET_SIZE', size: nextSize });
    dispatch({ type: 'SET_ASPECT_RATIO', aspectRatio: nextAspectRatio });
    dispatch({ type: 'SET_ROTATION', rotation: nextRotation });

    if (aduShapeType !== 'rectangle') {
      dispatch({
        type: 'SET_LEG_DIMENSIONS',
        shape: aduShapeType,
        dims: DEFAULT_LEG_DIMENSIONS[aduShapeType] as any,
      });
    }

    dispatchCenter(nextCenter);

    if (aduType === 'attached') {
      snapAttachedPlacement({
        size: nextSize,
        aspectRatio: nextAspectRatio,
        rotation: nextRotation,
        center: nextCenter,
        legDimensions: DEFAULT_LEG_DIMENSIONS[aduShapeType as 'l-shape' | 't-shape' | 'u-shape'],
      });
    }
  }, [
    aduCenter,
    aduShapeType,
    aduType,
    dispatch,
    dispatchCenter,
    initialRectangleStateRef,
    movementBoundary,
    shapeStatesRef,
    snapAttachedPlacement,
  ]);

  const selectShape = useCallback(
    (nextShape: ShapeType) => {
      if (nextShape === aduShapeType) {
        return;
      }

      if (!aduCenter) {
        return;
      }

      shapeStatesRef.current[aduShapeType] = buildShapeState({
        center: aduCenter,
        size: aduSize,
        aspectRatio: aduAspectRatio,
        rotation: aduRotation,
        legDimensions: currentLegDimensions,
      });

      const cachedShape = shapeStatesRef.current[nextShape];
      const nextSize = cachedShape?.size ?? DEFAULT_ADU_SIZE_SQFT;
      const nextAspectRatio = cachedShape?.aspectRatio ?? DEFAULT_ADU_ASPECT_RATIO;
      const nextRotation = cachedShape?.rotation ?? 0;
      const nextCenter = cachedShape?.center ?? aduCenter;
      const nextLegDimensions =
        cachedShape?.legDimensions ??
        (nextShape !== 'rectangle' ? DEFAULT_LEG_DIMENSIONS[nextShape] : undefined);

      // ponytail: no fit-guard on switch — always apply the shape. If it lands
      // outside the setback zone, useAduValidation flags it invalid (red), same
      // as move/resize/rotate already do. Blocking here just froze the button.
      setAduShapeType(nextShape);
      dispatchCenter(nextCenter);
      dispatch({ type: 'SET_SIZE', size: nextSize });
      dispatch({ type: 'SET_ASPECT_RATIO', aspectRatio: nextAspectRatio });
      dispatch({ type: 'SET_ROTATION', rotation: nextRotation });

      if (nextShape !== 'rectangle') {
        dispatch({
          type: 'SET_LEG_DIMENSIONS',
          shape: nextShape,
          dims: nextLegDimensions as any,
        });
      }

      if (aduType === 'attached') {
        snapAttachedPlacement({
          shapeType: nextShape,
          size: nextSize,
          aspectRatio: nextAspectRatio,
          rotation: nextRotation,
          center: nextCenter,
          legDimensions: nextLegDimensions,
        });
      }
    },
    [
      aduAspectRatio,
      aduCenter,
      aduRotation,
      aduShapeType,
      aduSize,
      aduType,
      currentLegDimensions,
      dispatch,
      dispatchCenter,
      setAduShapeType,
      shapeStatesRef,
      snapAttachedPlacement,
    ],
  );

  const updateSize = useCallback(
    (rawValue: number) => {
      const nextSize = clamp(rawValue, FLOOR_AREA_MIN, aduMaxArea);

      if (
        !canPlaceDetachedShape({
          aduType,
          movementBoundary,
          center: aduCenter,
          size: nextSize,
          aspectRatio: aduAspectRatio,
          rotation: aduRotation,
          shapeType: aduShapeType,
          legDimensions: currentLegDimensions,
        })
      ) {
        return;
      }

      dispatch({ type: 'SET_SIZE', size: nextSize });

      if (aduType === 'attached') {
        snapAttachedPlacement({ size: nextSize });
      }
    },
    [
      aduAspectRatio,
      aduCenter,
      aduMaxArea,
      aduRotation,
      aduShapeType,
      aduType,
      currentLegDimensions,
      dispatch,
      movementBoundary,
      snapAttachedPlacement,
    ],
  );

  const updateAspectRatioFromSlider = useCallback(
    (rawValue: number) => {
      const nextAspectRatio = clamp(
        0.3 + ((rawValue - 1) / 99) * 2.7,
        ASPECT_RATIO_MIN,
        ASPECT_RATIO_MAX,
      );

      if (
        !canPlaceDetachedShape({
          aduType,
          movementBoundary,
          center: aduCenter,
          size: aduSize,
          aspectRatio: nextAspectRatio,
          rotation: aduRotation,
          shapeType: aduShapeType,
          legDimensions: currentLegDimensions,
        })
      ) {
        return;
      }

      dispatch({ type: 'SET_ASPECT_RATIO', aspectRatio: nextAspectRatio });

      if (aduType === 'attached') {
        snapAttachedPlacement({ aspectRatio: nextAspectRatio });
      }
    },
    [
      aduCenter,
      aduRotation,
      aduShapeType,
      aduSize,
      aduType,
      currentLegDimensions,
      dispatch,
      movementBoundary,
      snapAttachedPlacement,
    ],
  );

  const updateDetachedRotation = useCallback(
    (rawValue: number) => {
      const nextRotation = clamp(rawValue, ORIENTATION_MIN, ORIENTATION_MAX);

      if (
        !canPlaceDetachedShape({
          aduType,
          movementBoundary,
          center: aduCenter,
          size: aduSize,
          aspectRatio: aduAspectRatio,
          rotation: nextRotation,
          shapeType: aduShapeType,
          legDimensions: currentLegDimensions,
        })
      ) {
        return;
      }

      dispatch({ type: 'SET_ROTATION', rotation: nextRotation });
    },
    [
      aduAspectRatio,
      aduCenter,
      aduShapeType,
      aduSize,
      aduType,
      currentLegDimensions,
      dispatch,
      movementBoundary,
    ],
  );

  const rotateAttached = useCallback(
    (delta: number) => {
      const nextRotation = (aduRotation + delta + 360) % 360;
      dispatch({ type: 'SET_ROTATION', rotation: nextRotation });
      snapAttachedPlacement({ rotation: nextRotation });
    },
    [aduRotation, dispatch, snapAttachedPlacement],
  );

  const toggleAdvancedSettings = useCallback(() => {
    setShowAdvancedSettings(!showAdvancedSettings);
  }, [setShowAdvancedSettings, showAdvancedSettings]);

  const toggleAutoEdgeAlign = useCallback(() => {
    setAutoEdgeAlign(!autoEdgeAlign);
  }, [autoEdgeAlign, setAutoEdgeAlign]);

  const toggleAutoPositionCorrection = useCallback(() => {
    setAutoPositionCorrection(!autoPositionCorrection);
  }, [autoPositionCorrection, setAutoPositionCorrection]);

  return {
    aspectRatioSliderValue,
    selectAduType,
    resetCurrentShape,
    selectShape,
    updateSize,
    updateAspectRatioFromSlider,
    updateDetachedRotation,
    rotateAttachedLeft: () => rotateAttached(-90),
    rotateAttachedRight: () => rotateAttached(90),
    toggleAdvancedSettings,
    toggleAutoEdgeAlign,
    toggleAutoPositionCorrection,
  };
}
