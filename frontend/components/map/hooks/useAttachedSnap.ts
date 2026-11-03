import type * as React from 'react';
import { useCallback } from 'react';
import * as turf from '@turf/turf';
import type { AnalyzeResponse } from '@/types';
import type { ShapeType, SnapResult, LegDimensions, AduAction } from '../types';
import {
  extractWallSegments,
  generateAduPolygon,
  translateCoordsByMeters,
  translateCenterByMeters,
} from '../utils/geometry';
import {
  lockRotationFromNearestWall,
  findContactAnchor,
  computeFlushPosition,
  resolveActiveWallFaces,
  pushOutwardUntilClear,
  slideAlongWall,
  validateFinalPosition,
} from '../utils/attachedSnapping';

export function useAttachedSnap({
  result,
  disabledBuildings,
  attachedReachabilityRef,
  aduType,
  aduRotation,
  aduSize,
  aduAspectRatio,
  aduShapeType,
  legDimensions,
  aduCenterRef,
  animateAutoCorrectTo,
  dispatchCenter,
  dispatch,
}: {
  result: AnalyzeResponse | null;
  disabledBuildings: Set<number>;
  attachedReachabilityRef: React.MutableRefObject<{
    boundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
    reachableSecondaryIndices: number[];
  } | null>;
  aduType: 'detached' | 'attached';
  aduRotation: number;
  aduSize: number;
  aduAspectRatio: number;
  aduShapeType: ShapeType;
  legDimensions: LegDimensions;
  aduCenterRef: React.MutableRefObject<{ lng: number; lat: number } | null>;
  animateAutoCorrectTo: (
    targetCenter: { lng: number; lat: number },
    onComplete?: () => void,
  ) => void;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: React.Dispatch<AduAction>;
}) {
  const snapToNearestWall = useCallback(
    (
      targetLng: number,
      targetLat: number,
      currentAduRotation: number,
      currentAduSize: number,
      currentAduAspectRatio: number,
      currentAduShapeType: ShapeType,
      legDimensions: LegDimensions[keyof LegDimensions] | undefined,
    ): SnapResult | null => {
      const primaryGeom = result?.detected_buildings?.[0] as GeoJSON.Geometry | undefined;
      if (!primaryGeom) return null;
      const primaryFeature = turf.feature(primaryGeom as any);
      const wallSegments = extractWallSegments(primaryGeom);
      if (!wallSegments.length) return null;

      const dropPoint = turf.point([targetLng, targetLat]);
      const ctx = { primaryGeom, primaryFeature, wallSegments, dropPoint };

      const stage1 = lockRotationFromNearestWall(ctx, currentAduRotation);
      if (!stage1) return null;
      const { bestRotation } = stage1;

      const rotatedAtDrop = generateAduPolygon(
        { lng: targetLng, lat: targetLat },
        currentAduSize,
        currentAduAspectRatio,
        bestRotation,
        currentAduShapeType,
        legDimensions,
      );
      if (!rotatedAtDrop) return null;
      const ring = rotatedAtDrop.coordinates[0];
      if (ring.length < 2) return null;

      const anchor = findContactAnchor(ring, wallSegments);
      if (!anchor) return null;

      const flush = computeFlushPosition(
        targetLng,
        targetLat,
        anchor.wallAnchor,
        anchor.aduAnchor,
        currentAduSize,
        currentAduAspectRatio,
        bestRotation,
        currentAduShapeType,
        legDimensions,
      );
      if (!flush) return null;
      const { flushCenter, flushPoly } = flush;

      const stage5 = resolveActiveWallFaces(
        wallSegments,
        anchor.aduSurfaceCandidates,
        anchor.anchorSegment,
        primaryFeature,
      );

      const pushResult = pushOutwardUntilClear(
        flushPoly,
        stage5.outwardEastUnit,
        stage5.outwardNorthUnit,
        primaryFeature,
      );
      if (!pushResult) return null;
      const { minimumPush, pushedCoords } = pushResult;

      const pushedCenter = translateCenterByMeters(
        flushCenter,
        stage5.outwardEastUnit * minimumPush,
        stage5.outwardNorthUnit * minimumPush,
      );

      const slideResult = slideAlongWall(
        stage5.dominantWallFace,
        flushPoly,
        wallSegments,
        pushedCoords,
        pushedCenter,
        dropPoint,
      );

      const finalCoords = translateCoordsByMeters(
        pushedCoords,
        slideResult.wallUnitEast * slideResult.bestSlideOffset,
        slideResult.wallUnitNorth * slideResult.bestSlideOffset,
      );
      const finalPoly = turf.polygon([finalCoords]);
      const finalCenter = translateCenterByMeters(
        pushedCenter,
        slideResult.wallUnitEast * slideResult.bestSlideOffset,
        slideResult.wallUnitNorth * slideResult.bestSlideOffset,
      );

      const isValid = validateFinalPosition(
        finalCoords,
        finalPoly,
        result as any,
        disabledBuildings,
        attachedReachabilityRef.current?.reachableSecondaryIndices ?? null,
      );

      // Attached snapping logging removed for production clarity

      return {
        lng: finalCenter.lng,
        lat: finalCenter.lat,
        rotation: bestRotation,
        isValid,
      };
    },
    [result, disabledBuildings, attachedReachabilityRef],
  );

  const snapAttachedPlacement = useCallback(
    (options?: {
      center?: { lng: number; lat: number };
      rotation?: number;
      size?: number;
      aspectRatio?: number;
      shapeType?: ShapeType;
      legDimensions?: LegDimensions[keyof LegDimensions];
      customPolygon?: GeoJSON.Polygon | null;
      animate?: boolean;
    }) => {
      if (aduType !== 'attached') return false;
      const center = options?.center ?? aduCenterRef.current;
      if (!center) return false;

      const rotation = options?.rotation ?? aduRotation;
      const size = options?.size ?? aduSize;
      const aspectRatio = options?.aspectRatio ?? aduAspectRatio;
      const shapeType = options?.shapeType ?? aduShapeType;
      const legDims =
        options?.legDimensions ??
        (shapeType !== 'rectangle' ? legDimensions[shapeType] : undefined);
      const customPolygon = options?.customPolygon ?? null;
      const shouldAnimate = options?.animate ?? false;
      void customPolygon;

      const snapped = snapToNearestWall(
        center.lng,
        center.lat,
        rotation,
        size,
        aspectRatio,
        shapeType,
        legDims,
      );

      if (!snapped) {
        dispatch({ type: 'SET_ATTACHED_SNAP_PENDING', pending: false });
        return false;
      }

      dispatch({ type: 'SET_ROTATION', rotation: snapped.rotation });
      if (shouldAnimate) {
        dispatch({ type: 'SET_ATTACHED_SNAP_PENDING', pending: true });
        dispatch({ type: 'SET_IS_VALID', isValid: false });
        animateAutoCorrectTo({ lng: snapped.lng, lat: snapped.lat }, () => {
          dispatch({ type: 'SET_IS_VALID', isValid: snapped.isValid });
          dispatch({ type: 'SET_ATTACHED_SNAP_PENDING', pending: false });
        });
        return true;
      }

      dispatchCenter({ lng: snapped.lng, lat: snapped.lat });
      dispatch({ type: 'SET_IS_VALID', isValid: snapped.isValid });
      dispatch({ type: 'SET_ATTACHED_SNAP_PENDING', pending: false });
      return true;
    },
    [
      aduType,
      aduRotation,
      aduSize,
      aduAspectRatio,
      aduShapeType,
      legDimensions,
      snapToNearestWall,
      animateAutoCorrectTo,
      dispatchCenter,
      aduCenterRef,
      dispatch,
    ],
  );

  return { snapToNearestWall, snapAttachedPlacement };
}
