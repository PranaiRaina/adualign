import * as turf from '@turf/turf';
import polylabel from 'polylabel';

import type { AnalyzeResponse } from '@/types';
import { isPolygonWithinZone } from './polygonContainment';

import {
  PLACEMENT_GRID_SAMPLES,
  PLACEMENT_ASPECT_RATIOS,
  PLACEMENT_ROTATION_STEP_DEG,
  PLACEMENT_LOCAL_ROTATION_STEP_DEG,
  PLACEMENT_LOCAL_CENTER_STEP_METERS,
  PLACEMENT_LOCAL_CENTER_RINGS,
  PLACEMENT_REFINE_INITIAL_STEP_METERS,
  PLACEMENT_REFINE_DIRECTIONS,
  PLACEMENT_BINARY_SEARCH_ITERS,
  PLACEMENT_MAX_LOCAL_SPAWN_SQFT,
  PLACEMENT_REFINE_ROUNDS,
  PLACEMENT_ROBUST_FINALISTS_MIN,
  PLACEMENT_ROBUST_FINALISTS_MAX,
  PLACEMENT_ROBUST_FINALISTS_SMALL_BUILDABLE_SQFT,
  PLACEMENT_ROBUST_FINALISTS_LARGE_BUILDABLE_SQFT,
  SQM_TO_SQFT,
  POLYLABEL_PRECISION_FINE,
  FLOOR_AREA_MIN,
} from '../constants';

interface PlacementCandidate extends OptimalPlacement {}

type GenerateAduPolygon = (
  center: { lng: number; lat: number },
  size: number,
  aspectRatio: number,
  rotation: number,
  shapeType: 'rectangle' | 'l-shape' | 't-shape' | 'u-shape',
) => GeoJSON.Polygon | null;

export interface OptimalPlacement {
  lng: number;
  lat: number;
  size: number;
  aspectRatio: number;
  rotation: number;
}

const getLargestPolyRings = (
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): number[][][] | null => {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates as number[][][];
  }

  let maxArea = -1;
  let bestPoly: number[][][] | null = null;
  for (const poly of geometry.coordinates) {
    const area = turf.area(turf.polygon(poly as number[][][]));
    if (area > maxArea) {
      maxArea = area;
      bestPoly = poly as number[][][];
    }
  }

  return bestPoly;
};

const getDynamicRobustFinalistCount = (buildableAreaSqft: number): number => {
  if (!Number.isFinite(buildableAreaSqft) || buildableAreaSqft <= 0) {
    return PLACEMENT_ROBUST_FINALISTS_MAX;
  }
  if (buildableAreaSqft <= PLACEMENT_ROBUST_FINALISTS_SMALL_BUILDABLE_SQFT) {
    return PLACEMENT_ROBUST_FINALISTS_MAX;
  }
  if (buildableAreaSqft >= PLACEMENT_ROBUST_FINALISTS_LARGE_BUILDABLE_SQFT) {
    return PLACEMENT_ROBUST_FINALISTS_MIN;
  }

  const t =
    (buildableAreaSqft - PLACEMENT_ROBUST_FINALISTS_SMALL_BUILDABLE_SQFT) /
    (PLACEMENT_ROBUST_FINALISTS_LARGE_BUILDABLE_SQFT -
      PLACEMENT_ROBUST_FINALISTS_SMALL_BUILDABLE_SQFT);
  // Inverse gradient: smaller lots => more finalists, larger lots => fewer.
  const count =
    PLACEMENT_ROBUST_FINALISTS_MAX -
    t * (PLACEMENT_ROBUST_FINALISTS_MAX - PLACEMENT_ROBUST_FINALISTS_MIN);
  return Math.round(count);
};

export function findOptimalAduPlacement(
  result: AnalyzeResponse,
  generateAduPolygon: GenerateAduPolygon,
): OptimalPlacement | null {
  try {
    const buildableGeometry = result.buildable_zone_geojson;
    if (
      !buildableGeometry ||
      (buildableGeometry.type !== 'Polygon' && buildableGeometry.type !== 'MultiPolygon')
    ) {
      return null;
    }

    const buildableFeature = turf.feature(
      buildableGeometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    );
    const buildableAreaSqft = turf.area(buildableFeature) * SQM_TO_SQFT;
    const robustFinalistCount = getDynamicRobustFinalistCount(buildableAreaSqft);
    const [minX, minY, maxX, maxY] = turf.bbox(buildableFeature);
    const dx = (maxX - minX) / PLACEMENT_GRID_SAMPLES;
    const dy = (maxY - minY) / PLACEMENT_GRID_SAMPLES;
    const maxSizeCap = Math.max(
      FLOOR_AREA_MIN,
      result.max_adu_sqft ?? PLACEMENT_MAX_LOCAL_SPAWN_SQFT,
    );
    const fastContainsAt = (
      center: { lng: number; lat: number },
      size: number,
      aspectRatio: number,
      rotation: number,
    ) => {
      const poly = generateAduPolygon(center, size, aspectRatio, rotation, 'rectangle');
      if (!poly) return false;
      return turf.booleanContains(buildableFeature as any, turf.feature(poly));
    };

    const robustContainsAt = (
      center: { lng: number; lat: number },
      size: number,
      aspectRatio: number,
      rotation: number,
    ) => {
      const poly = generateAduPolygon(center, size, aspectRatio, rotation, 'rectangle');
      if (!poly) return false;
      return isPolygonWithinZone(buildableFeature as any, poly);
    };

    const binarySearchMaxSize = (
      center: { lng: number; lat: number },
      aspectRatio: number,
      rotation: number,
      containsFn: (c: { lng: number; lat: number }, s: number, ar: number, r: number) => boolean,
      upperBound = maxSizeCap,
    ): number => {
      // If minimum legal size does not fit, this candidate is infeasible.
      if (!containsFn(center, FLOOR_AREA_MIN, aspectRatio, rotation)) {
        return 0;
      }

      let lo = FLOOR_AREA_MIN;
      let hi = upperBound;

      for (let i = 0; i < PLACEMENT_BINARY_SEARCH_ITERS; i++) {
        const mid = (lo + hi) / 2;
        const contains = containsFn(center, mid, aspectRatio, rotation);
        if (contains) {
          lo = mid;
        } else {
          hi = mid;
        }
      }

      return lo;
    };

    // Phase 1: grid sweep over centers x aspect ratios x rotations.
    const candidates: Array<{ lng: number; lat: number }> = [];
    for (let gx = 0; gx < PLACEMENT_GRID_SAMPLES; gx++) {
      for (let gy = 0; gy < PLACEMENT_GRID_SAMPLES; gy++) {
        const lng = minX + (gx + 0.5) * dx;
        const lat = minY + (gy + 0.5) * dy;
        if (turf.booleanPointInPolygon(turf.point([lng, lat]), buildableFeature)) {
          candidates.push({ lng, lat });
        }
      }
    }

    const rings = getLargestPolyRings(buildableGeometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
    if (rings) {
      const interior = polylabel(rings, POLYLABEL_PRECISION_FINE);
      const interiorPoint: [number, number] = [interior[0], interior[1]];
      if (
        Array.isArray(interior) &&
        interior.length >= 2 &&
        turf.booleanPointInPolygon(turf.point(interiorPoint), buildableFeature)
      ) {
        candidates.push({ lng: interior[0], lat: interior[1] });
      }
    }

    let best: OptimalPlacement | null = null;
    const finalists: PlacementCandidate[] = [];
    const pushFinalist = (candidate: PlacementCandidate) => {
      finalists.push(candidate);
      finalists.sort((a, b) => b.size - a.size);
      if (finalists.length > robustFinalistCount) finalists.length = robustFinalistCount;
    };

    for (const center of candidates) {
      for (const aspectRatio of PLACEMENT_ASPECT_RATIOS) {
        for (let rotation = 0; rotation < 180; rotation += PLACEMENT_ROTATION_STEP_DEG) {
          const size = binarySearchMaxSize(center, aspectRatio, rotation, fastContainsAt);
          if (!best || size > best.size) {
            best = {
              lng: center.lng,
              lat: center.lat,
              size,
              aspectRatio,
              rotation,
            };
          }
          if (size >= FLOOR_AREA_MIN) {
            pushFinalist({
              lng: center.lng,
              lat: center.lat,
              size,
              aspectRatio,
              rotation,
            });
          }
        }
      }
    }

    if (!best) return null;
    let workingBest: OptimalPlacement = best;

    // Phase 1.5: local dense refinement around the best coarse candidate.
    const localCenters: Array<{ lng: number; lat: number }> = [
      { lng: workingBest.lng, lat: workingBest.lat },
    ];
    for (let ring = 1; ring <= PLACEMENT_LOCAL_CENTER_RINGS; ring++) {
      const stepMeters = PLACEMENT_LOCAL_CENTER_STEP_METERS * ring;
      for (let b = 0; b < 360; b += 45) {
        const p = turf.destination(
          turf.point([workingBest.lng, workingBest.lat]),
          stepMeters / 1000,
          b,
          { units: 'kilometers' },
        );
        const [lng, lat] = p.geometry.coordinates;
        if (turf.booleanPointInPolygon(turf.point([lng, lat]), buildableFeature)) {
          localCenters.push({ lng, lat });
        }
      }
    }

    const localAspectRatios = Array.from(
      new Set([
        workingBest.aspectRatio,
        ...PLACEMENT_ASPECT_RATIOS.filter((ar) => Math.abs(ar - workingBest.aspectRatio) <= 0.5),
      ]),
    );
    for (const center of localCenters) {
      for (const aspectRatio of localAspectRatios) {
        for (let delta = -15; delta <= 15; delta += PLACEMENT_LOCAL_ROTATION_STEP_DEG) {
          const rotationCandidate: number = (((workingBest.rotation + delta) % 180) + 180) % 180;
          const size = binarySearchMaxSize(center, aspectRatio, rotationCandidate, fastContainsAt);
          if (size > workingBest.size) {
            workingBest = {
              lng: center.lng,
              lat: center.lat,
              size,
              aspectRatio,
              rotation: rotationCandidate,
            };
          }
          if (size >= FLOOR_AREA_MIN) {
            pushFinalist({
              lng: center.lng,
              lat: center.lat,
              size,
              aspectRatio,
              rotation: rotationCandidate,
            });
          }
        }
      }
    }

    // Phase 2: hill-climb center refinement with fixed aspect ratio and rotation.
    let refineCenter = { lng: workingBest.lng, lat: workingBest.lat };
    let stepMeters = PLACEMENT_REFINE_INITIAL_STEP_METERS;
    const angleStep = 360 / PLACEMENT_REFINE_DIRECTIONS;

    for (let round = 0; round < PLACEMENT_REFINE_ROUNDS; round++) {
      let improved = false;

      for (let d = 0; d < PLACEMENT_REFINE_DIRECTIONS; d++) {
        const bearing = d * angleStep;
        const dest = turf.destination(
          turf.point([refineCenter.lng, refineCenter.lat]),
          stepMeters / 1000,
          bearing,
          { units: 'kilometers' },
        );
        const [lng, lat] = dest.geometry.coordinates;

        if (!turf.booleanPointInPolygon(turf.point([lng, lat]), buildableFeature)) {
          continue;
        }

        const size = binarySearchMaxSize(
          { lng, lat },
          workingBest.aspectRatio,
          workingBest.rotation,
          fastContainsAt,
        );
        if (size > workingBest.size) {
          workingBest = { ...workingBest, lng, lat, size };
          refineCenter = { lng, lat };
          improved = true;
          break;
        }
        if (size >= FLOOR_AREA_MIN) {
          pushFinalist({
            lng,
            lat,
            size,
            aspectRatio: workingBest.aspectRatio,
            rotation: workingBest.rotation,
          });
        }
      }

      if (!improved) {
        stepMeters /= 2;
      }
    }

    // Final pass: robustly verify top fast candidates and pick the best robust fit.
    let robustBest: OptimalPlacement | null = null;
    for (const candidate of finalists) {
      const robustSize = binarySearchMaxSize(
        { lng: candidate.lng, lat: candidate.lat },
        candidate.aspectRatio,
        candidate.rotation,
        robustContainsAt,
        candidate.size,
      );
      if (robustSize < FLOOR_AREA_MIN) continue;
      if (!robustBest || robustSize > robustBest.size) {
        robustBest = {
          lng: candidate.lng,
          lat: candidate.lat,
          size: robustSize,
          aspectRatio: candidate.aspectRatio,
          rotation: candidate.rotation,
        };
      }
    }

    // Never return a fast-only candidate; initial auto-placement must be robust-valid.
    if (!robustBest || robustBest.size < FLOOR_AREA_MIN) {
      return null;
    }

    // Whole sqft for UI/state: floor so the footprint never exceeds the searched max.
    return { ...robustBest, size: Math.floor(robustBest.size) };
  } catch {
    return null;
  }
}
