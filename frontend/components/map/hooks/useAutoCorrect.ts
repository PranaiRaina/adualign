import type * as React from 'react';
import { useRef, useCallback, useEffect } from 'react';
import * as turf from '@turf/turf';
import { isPolygonWithinZone } from '../utils/polygonContainment';
import { generateAduPolygon } from '../utils/geometry';
import {
  AUTO_CORRECT_THRESHOLD_METERS,
  AUTO_CORRECT_ANIMATION_STEPS,
  AUTO_CORRECT_ANIMATION_INTERVAL_MS,
  AUTO_CORRECT_START_OFFSET_METERS,
  AUTO_CORRECT_DIST_STEP_METERS,
  AUTO_CORRECT_BACKOFF_METERS,
  AUTO_CORRECT_RADIAL_START_METERS,
  AUTO_CORRECT_RADIAL_STEP_METERS,
  AUTO_CORRECT_RADIAL_TOLERANCE_METERS,
  AUTO_CORRECT_BINARY_SEARCH_ITERS,
  AUTO_CORRECT_ANGLE_STEP_DEG,
  RADIAL_SEARCH_ANGLE_STEP_DEG,
  METERS_PER_DEGREE_LAT,
  MIN_COS_LAT,
} from '../constants';
import type { AnalyzeResponse } from '@/types';
import type { AduAction, ShapeType, LegDimensions } from '../types';

export function useAutoCorrect({
  aduCenterRef,
  aduType,
  result,
  aduSize,
  aduAspectRatio,
  aduRotation,
  aduShapeType,
  currentLegDimensions,
  dispatchCenter,
  dispatch,
}: {
  aduCenterRef: React.MutableRefObject<{ lng: number; lat: number } | null>;
  aduType: 'detached' | 'attached';
  result: AnalyzeResponse | null;
  aduSize: number;
  aduAspectRatio: number;
  aduRotation: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: React.Dispatch<AduAction>;
}) {
  const autoCorrectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoCorrectTargetRef = useRef<{ lng: number; lat: number } | null>(null);

  const stopAutoCorrectAnimation = useCallback(
    (snapToFinalTarget: boolean) => {
      if (autoCorrectIntervalRef.current) {
        clearInterval(autoCorrectIntervalRef.current);
        autoCorrectIntervalRef.current = null;
      }
      if (snapToFinalTarget && autoCorrectTargetRef.current) {
        dispatchCenter(autoCorrectTargetRef.current);
      }
      autoCorrectTargetRef.current = null;
      dispatch({ type: 'SET_AUTO_CORRECTING', correcting: false });
      dispatch({ type: 'SET_ATTACHED_SNAP_PENDING', pending: false });
    },
    [dispatchCenter, dispatch],
  );

  /**
   * Find a valid nearby position for a detached ADU if it's slightly out of bounds.
   * This provides an "intelligent snap" when the user releases the drag handle near
   * the buildable zone boundary.
   *
   * The algorithm uses a tiered search:
   * Phase 1: Radial ray search (16 directions) with binary refinement.
   * Phase 2: Local spiral search (fallback) to catch complex corner cases.
   */
  const findDetachedAutoCorrectTarget = useCallback(() => {
    const currentCenter = aduCenterRef.current;
    if (!currentCenter || aduType !== 'detached' || !result?.buildable_zone_geojson) {
      return null;
    }

    // -- 1. Setup buildable zone geometries --
    const buildableFeature = turf.feature(
      result.buildable_zone_geojson as unknown as GeoJSON.Geometry,
    );
    const buildableBoundary = turf.polygonToLine(buildableFeature as any);
    const currentCenterPoint = turf.point([currentCenter.lng, currentCenter.lat]);

    // -- 2. Pre-check: Is the ADU already valid or too far away? --
    const currentAduPoly = generateAduPolygon(
      currentCenter,
      aduSize,
      aduAspectRatio,
      aduRotation,
      aduShapeType,
      currentLegDimensions,
    );
    if (!currentAduPoly) return null;

    // Skip if already entirely inside buildable zone
    if (isPolygonWithinZone(buildableFeature as any, currentAduPoly as any)) {
      return null;
    }

    // Skip if ADU is completely outside the threshold (3m) of the buildable zone
    let minAduEdgeToBoundaryMeters = Infinity;
    for (const coord of currentAduPoly.coordinates[0] || []) {
      const pt = turf.point(coord);
      const nearest = turf.nearestPointOnLine(buildableBoundary as any, pt);
      const d = turf.distance(pt, nearest, { units: 'meters' });
      if (d < minAduEdgeToBoundaryMeters) minAduEdgeToBoundaryMeters = d;
    }

    if (
      !Number.isFinite(minAduEdgeToBoundaryMeters) ||
      minAduEdgeToBoundaryMeters > AUTO_CORRECT_THRESHOLD_METERS
    ) {
      return null;
    }

    // -- 3. Solver Helpers --
    const nearestBoundaryPoint = turf.nearestPointOnLine(
      buildableBoundary as any,
      currentCenterPoint,
    );
    const bearingToBoundary = turf.bearing(currentCenterPoint, nearestBoundaryPoint);

    const moveCenter = (distanceMeters: number, bearing: number) => {
      const moved = turf.destination(currentCenterPoint, distanceMeters / 1000, bearing, {
        units: 'kilometers',
      });
      return { lng: moved.geometry.coordinates[0], lat: moved.geometry.coordinates[1] };
    };

    const checkValidity = (candidateCenter: { lng: number; lat: number }) => {
      const poly = generateAduPolygon(
        candidateCenter,
        aduSize,
        aduAspectRatio,
        aduRotation,
        aduShapeType,
        currentLegDimensions,
      );
      return poly ? isPolygonWithinZone(buildableFeature as any, poly as any) : false;
    };

    // -- 4. Phase 1: Radial Ray Search --
    // Sample 16 radial directions including the normal to the nearest boundary.
    const candidateBearings = [bearingToBoundary, (bearingToBoundary + 180) % 360];
    for (let b = 0; b < 360; b += RADIAL_SEARCH_ANGLE_STEP_DEG) candidateBearings.push(b);

    let bestSolution: { center: { lng: number; lat: number }; distance: number } | null = null;
    const seenBearings = new Set<string>();

    for (const rawBearing of candidateBearings) {
      const bearing = ((rawBearing % 360) + 360) % 360;
      if (seenBearings.has(bearing.toFixed(2))) continue;
      seenBearings.add(bearing.toFixed(2));

      // Step along ray to find first valid point
      let firstValidDist: number | null = null;
      for (
        let d = AUTO_CORRECT_START_OFFSET_METERS;
        d <= AUTO_CORRECT_THRESHOLD_METERS + AUTO_CORRECT_START_OFFSET_METERS;
        d += AUTO_CORRECT_DIST_STEP_METERS
      ) {
        if (checkValidity(moveCenter(d, bearing))) {
          firstValidDist = d;
          break;
        }
      }

      // If valid point found, binary search for the precise entry point
      if (firstValidDist !== null) {
        let low = Math.max(0, firstValidDist - AUTO_CORRECT_BACKOFF_METERS),
          high = firstValidDist;
        for (let i = 0; i < AUTO_CORRECT_BINARY_SEARCH_ITERS; i++) {
          const mid = (low + high) / 2;
          if (checkValidity(moveCenter(mid, bearing))) high = mid;
          else low = mid;
        }
        if (!bestSolution || high < bestSolution.distance) {
          bestSolution = { center: moveCenter(high, bearing), distance: high };
        }
      }
    }

    if (bestSolution) return bestSolution.center;

    // -- 5. Phase 2: Robust Fallback - Local Spiral Search --
    // Catches complex boundary cases where simple rays might miss due to
    // concave buildable zones or high aspect ratio ADUs.
    const latRad = (currentCenter.lat * Math.PI) / 180;
    const degPerMeterLat = 1 / METERS_PER_DEGREE_LAT;
    const degPerMeterLng = 1 / (METERS_PER_DEGREE_LAT * Math.max(MIN_COS_LAT, Math.cos(latRad)));

    for (
      let r = AUTO_CORRECT_RADIAL_START_METERS;
      r <= AUTO_CORRECT_THRESHOLD_METERS + AUTO_CORRECT_RADIAL_TOLERANCE_METERS;
      r += AUTO_CORRECT_RADIAL_STEP_METERS
    ) {
      for (let angle = 0; angle < 360; angle += AUTO_CORRECT_ANGLE_STEP_DEG) {
        const rad = (angle * Math.PI) / 180;
        const candidate = {
          lng: currentCenter.lng + r * Math.cos(rad) * degPerMeterLng,
          lat: currentCenter.lat + r * Math.sin(rad) * degPerMeterLat,
        };
        if (checkValidity(candidate)) return candidate;
      }
    }

    return null;
  }, [
    aduCenterRef,
    aduType,
    result,
    aduSize,
    aduAspectRatio,
    aduRotation,
    aduShapeType,
    currentLegDimensions,
  ]);

  const animateAutoCorrectTo = useCallback(
    (targetCenter: { lng: number; lat: number }, onComplete?: () => void) => {
      const startCenter = aduCenterRef.current;
      if (!startCenter) return;

      stopAutoCorrectAnimation(false);
      let step = 0;

      dispatch({ type: 'SET_AUTO_CORRECTING', correcting: true });
      autoCorrectTargetRef.current = targetCenter;

      autoCorrectIntervalRef.current = setInterval(() => {
        step += 1;
        const t = Math.min(step / AUTO_CORRECT_ANIMATION_STEPS, 1);
        dispatchCenter({
          lng: startCenter.lng + (targetCenter.lng - startCenter.lng) * t,
          lat: startCenter.lat + (targetCenter.lat - startCenter.lat) * t,
        });

        if (step >= AUTO_CORRECT_ANIMATION_STEPS) {
          if (autoCorrectIntervalRef.current) {
            clearInterval(autoCorrectIntervalRef.current);
            autoCorrectIntervalRef.current = null;
          }
          autoCorrectTargetRef.current = null;
          dispatch({ type: 'SET_AUTO_CORRECTING', correcting: false });
          onComplete?.();
        }
      }, AUTO_CORRECT_ANIMATION_INTERVAL_MS);
    },
    [aduCenterRef, stopAutoCorrectAnimation, dispatch, dispatchCenter],
  );

  useEffect(() => {
    return () => {
      stopAutoCorrectAnimation(false);
    };
  }, [stopAutoCorrectAnimation]);

  return { stopAutoCorrectAnimation, findDetachedAutoCorrectTarget, animateAutoCorrectTo };
}
