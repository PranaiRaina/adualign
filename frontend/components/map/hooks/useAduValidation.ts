import type * as React from 'react';
import { useMemo, useCallback, useEffect } from 'react';
import * as turf from '@turf/turf';
import { isPolygonWithinZone } from '../utils/polygonContainment';
import { FOUR_FEET_METERS, SIX_FEET_METERS } from '../constants';
import type { AnalyzeResponse } from '@/types';
import type { AduAction } from '../types';

export function useAduValidation({
  aduPolygon,
  result,
  disabledBuildings,
  aduType,
  isDraggingAdu,
  isAttachedSnapPending,
  isAutoCorrecting,
  attachedReachableSecondaryIndices,
  attachedReachabilityRef,
  dispatch,
}: {
  aduPolygon: GeoJSON.Polygon | null;
  result: AnalyzeResponse | null;
  disabledBuildings: Set<number>;
  aduType: 'detached' | 'attached';
  isDraggingAdu: boolean;
  isAttachedSnapPending: boolean;
  isAutoCorrecting: boolean;
  attachedReachableSecondaryIndices: number[];
  attachedReachabilityRef: React.MutableRefObject<{
    boundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
    reachableSecondaryIndices: number[];
  } | null>;
  dispatch: React.Dispatch<AduAction>;
}) {
  const invalidReasons = useMemo(() => {
    if (!aduPolygon || !result) return [];

    const reasons: string[] = [];

    if (aduType === 'attached') {
      // Check property line clearance (4ft)
      if (result.property_geojson) {
        const propertyLine = turf.polygonToLine(turf.feature(result.property_geojson as any));
        let pointsInside = 0;
        let pointsOutside = 0;
        let propertyLineViolated = false;

        for (const coord of aduPolygon.coordinates[0]) {
          const pt = turf.point(coord);
          if (turf.booleanPointInPolygon(pt, turf.feature(result.property_geojson as any))) {
            pointsInside++;
          } else {
            pointsOutside++;
          }
        }

        const isFullyOutside = pointsInside === 0;
        const isPartiallyOutside = pointsInside > 0 && pointsOutside > 0;

        if (!isFullyOutside) {
          for (const coord of aduPolygon.coordinates[0]) {
            const pt = turf.point(coord);
            const dist = turf.distance(pt, turf.nearestPointOnLine(propertyLine as any, pt), {
              units: 'feet',
            });
            if (dist < 4) {
              propertyLineViolated = true;
              break;
            }
          }
        }

        if (isFullyOutside) {
          reasons.push('Out of bounds');
        } else if (isPartiallyOutside) {
          reasons.push('Out of bounds');
          reasons.push('Violates 4ft property line setback');
        } else if (propertyLineViolated) {
          reasons.push('Violates 4ft property line setback');
        }
      }
      // Check 6ft from secondary structures
      let structureViolated = false;
      for (const i of attachedReachableSecondaryIndices) {
        if (disabledBuildings.has(i)) continue;
        const bldgFeature = turf.feature(result.detected_buildings[i] as any);
        const buffered = turf.buffer(bldgFeature, SIX_FEET_METERS, { units: 'meters' });
        if (turf.booleanIntersects(aduPolygon, buffered as any)) {
          structureViolated = true;
          break;
        }
      }

      // Check building overlaps purely for ALL disabled/non-disabled buildings that are invalid to overlap
      let overlapViolated = false;
      for (let i = 1; i < (result.detected_buildings?.length ?? 0); i++) {
        if (disabledBuildings.has(i)) continue;
        if (turf.booleanIntersects(aduPolygon, turf.feature(result.detected_buildings[i] as any))) {
          overlapViolated = true;
          break;
        }
      }
      // Note: for attached mode, we do NOT flag intersection with the primary building (i=0) as an invalid overlap here because they must touch
      // but we do check if it's deeply overlapping in the validation routine itself.

      if (structureViolated) {
        reasons.push('Violates 6ft structure setback');
      }
      if (overlapViolated) {
        reasons.push('Overlapping existing structure');
      }
    } else {
      // Detached: check buildable zone
      let outsideBuildable = false;
      if (result.buildable_zone_geojson) {
        const buildable = turf.feature(result.buildable_zone_geojson as any);
        if (!isPolygonWithinZone(buildable as any, aduPolygon as any)) {
          outsideBuildable = true;
        }
      }

      if (outsideBuildable) {
        let pointsInside = 0;
        let pointsOutside = 0;
        let propertyLineViolated = false;

        if (result.property_geojson) {
          const propertyLine = turf.polygonToLine(turf.feature(result.property_geojson as any));
          for (const coord of aduPolygon.coordinates[0]) {
            const pt = turf.point(coord);
            if (turf.booleanPointInPolygon(pt, turf.feature(result.property_geojson as any))) {
              pointsInside++;
            } else {
              pointsOutside++;
            }
          }

          const isFullyOutside = pointsInside === 0;
          const isPartiallyOutside = pointsInside > 0 && pointsOutside > 0;

          if (!isFullyOutside) {
            for (const coord of aduPolygon.coordinates[0]) {
              const pt = turf.point(coord);
              const dist = turf.distance(pt, turf.nearestPointOnLine(propertyLine as any, pt), {
                units: 'feet',
              });
              if (dist < 4) {
                propertyLineViolated = true;
                break;
              }
            }
          }

          if (isFullyOutside) {
            reasons.push('Out of bounds');
          } else if (isPartiallyOutside) {
            reasons.push('Out of bounds');
            reasons.push('Violates 4ft property line setback');
          } else if (propertyLineViolated) {
            reasons.push('Violates 4ft property line setback');
          }
        }

        let structureViolated = false;
        for (let i = 0; i < (result.detected_buildings?.length ?? 0); i++) {
          if (disabledBuildings.has(i)) continue;
          const buffered = turf.buffer(
            turf.feature(result.detected_buildings[i] as any),
            SIX_FEET_METERS,
            { units: 'meters' },
          );
          if (turf.booleanIntersects(aduPolygon, buffered as any)) {
            structureViolated = true;
            break;
          }
        }

        if (structureViolated) reasons.push('Violates 6ft structure setback');
        if (pointsOutside === 0 && !propertyLineViolated && !structureViolated) {
          reasons.push('Outside buildable zone (e.g. front yard restriction)');
        }
      }

      // Check building overlaps
      let overlapViolated = false;
      for (let i = 0; i < (result.detected_buildings?.length ?? 0); i++) {
        if (disabledBuildings.has(i)) continue;
        if (turf.booleanIntersects(aduPolygon, turf.feature(result.detected_buildings[i] as any))) {
          overlapViolated = true;
          break;
        }
      }
      if (overlapViolated) {
        reasons.push('Overlapping existing structure');
      }
    }

    return reasons;
  }, [aduPolygon, result, aduType, disabledBuildings, attachedReachableSecondaryIndices]);

  /**
   * Attached ADU validation: checks property-line clearance (≥ 4 ft)
   * and secondary-structure setback (6 ft). Returns true if valid.
   */
  const validateAttachedAdu = useCallback(
    (polygon: GeoJSON.Polygon, data: AnalyzeResponse, disabled: Set<number>): boolean => {
      // Rule 1: Must be >= 4 feet from the property line
      if (data.property_geojson) {
        const propertyFeature = turf.feature(data.property_geojson as unknown as GeoJSON.Geometry);
        const propertyLine = turf.polygonToLine(propertyFeature as any);

        const aduCoords = polygon.coordinates[0];
        for (const coord of aduCoords) {
          const pt = turf.point(coord);
          const insideProperty = turf.booleanPointInPolygon(pt, propertyFeature as any);
          if (!insideProperty) return false;

          const nearest = turf.nearestPointOnLine(propertyLine as any, pt);
          const dist = turf.distance(pt, nearest, { units: 'meters' });
          if (dist < FOUR_FEET_METERS) return false;
        }
      }

      // Rule 2: Must clear the 6ft setback from secondary structures (index > 0)
      if (data.detected_buildings && data.detected_buildings.length > 1) {
        const indicesToCheck =
          attachedReachabilityRef.current?.reachableSecondaryIndices ??
          Array.from({ length: data.detected_buildings.length - 1 }, (_, idx) => idx + 1);
        for (const i of indicesToCheck) {
          if (disabled.has(i)) continue;
          const building = data.detected_buildings[i];
          const buildingFeature = turf.feature(building as unknown as GeoJSON.Geometry);
          const bufferedBuilding = turf.buffer(buildingFeature, SIX_FEET_METERS, {
            units: 'meters',
          });
          if (turf.booleanIntersects(polygon, bufferedBuilding as any)) return false;
        }
      }

      return true;
    },
    [attachedReachabilityRef],
  );

  /**
   * Detached ADU validation: checks the polygon is fully within the
   * buildable zone and does not overlap any enabled building exclusion.
   * Returns true if valid.
   */
  const validateDetachedAdu = useCallback(
    (polygon: GeoJSON.Polygon, data: AnalyzeResponse, disabled: Set<number>): boolean => {
      if (!data.buildable_zone_geojson) return true;

      // 1. Check if ADU is inside the buildable zone (setbacks)
      const safeZone = data.buildable_zone_geojson as unknown as GeoJSON.Feature | GeoJSON.Geometry;

      const isInsideSafeZone = isPolygonWithinZone(
        safeZone.type === 'Feature'
          ? (safeZone as any)
          : (turf.feature(safeZone as GeoJSON.Geometry) as any),
        polygon as any,
      );

      if (!isInsideSafeZone) return false;

      // 2. Check if ADU overlaps with any existing building exclusion zones
      if (data.detected_buildings && data.detected_buildings.length > 0) {
        for (let i = 0; i < data.detected_buildings.length; i++) {
          if (disabled.has(i)) continue;
          const building = data.detected_buildings[i];
          const buildingFeature = turf.feature(building as unknown as GeoJSON.Geometry);
          if (turf.booleanIntersects(polygon, buildingFeature as any)) return false;
        }
      }

      return true;
    },
    [],
  );

  useEffect(() => {
    if (!aduPolygon) {
      dispatch({ type: 'SET_IS_VALID', isValid: true });
      return;
    }

    try {
      if (aduType === 'attached') {
        if (isDraggingAdu || isAttachedSnapPending || isAutoCorrecting) {
          // No geometry checks and no state churn during attached drag/animation.
          return;
        }
        dispatch({
          type: 'SET_IS_VALID',
          isValid: validateAttachedAdu(aduPolygon, result!, disabledBuildings),
        });
        return;
      }

      dispatch({
        type: 'SET_IS_VALID',
        isValid: validateDetachedAdu(aduPolygon, result!, disabledBuildings),
      });
    } catch (e: unknown) {
      console.error('Validation error:', e);
      dispatch({ type: 'SET_IS_VALID', isValid: false });
    }
  }, [
    aduPolygon,
    result,
    disabledBuildings,
    aduType,
    isDraggingAdu,
    isAttachedSnapPending,
    isAutoCorrecting,
    validateAttachedAdu,
    validateDetachedAdu,
    dispatch,
  ]);

  return { invalidReasons };
}
