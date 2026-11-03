import * as turf from '@turf/turf';

import type { AnalyzeResponse } from '@/types';
import type { ShapeType, LegDimensions } from '../types';
import { ALIGN_THRESHOLD_METERS } from '../constants';
import { generateAduPolygon, normalizeAngle, smallestAngleDiff } from './geometry';
import { isPolygonWithinZone } from './polygonContainment';

type LngLat = { lng: number; lat: number };

interface ResolveAutoEdgeAlignedRotationArgs {
  center: LngLat;
  currentRotation: number;
  aduSize: number;
  aduAspectRatio: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  movementBoundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
  buildableZoneGeojson: AnalyzeResponse['buildable_zone_geojson'];
}

function collectAllRings(buildableZoneGeojson: AnalyzeResponse['buildable_zone_geojson']) {
  if (!buildableZoneGeojson) {
    return [];
  }

  if (buildableZoneGeojson.type === 'Polygon') {
    return [...(buildableZoneGeojson.coordinates as number[][][])];
  }

  if (buildableZoneGeojson.type === 'MultiPolygon') {
    const rings: number[][][] = [];
    for (const polygon of buildableZoneGeojson.coordinates as number[][][][]) {
      rings.push(...polygon);
    }
    return rings;
  }

  return [];
}

function findNearestSegment(allRings: number[][][], centerSnapPt: number[]) {
  let nearestRingIdx = 0;
  let nearestSegIdx = 0;
  let minSegDist = Infinity;

  for (let ringIndex = 0; ringIndex < allRings.length; ringIndex++) {
    const ring = allRings[ringIndex];
    for (let segmentIndex = 0; segmentIndex < ring.length - 1; segmentIndex++) {
      const segmentMidpoint = [
        (ring[segmentIndex][0] + ring[segmentIndex + 1][0]) / 2,
        (ring[segmentIndex][1] + ring[segmentIndex + 1][1]) / 2,
      ];
      const distance = Math.hypot(
        centerSnapPt[0] - segmentMidpoint[0],
        centerSnapPt[1] - segmentMidpoint[1],
      );
      if (distance < minSegDist) {
        minSegDist = distance;
        nearestRingIdx = ringIndex;
        nearestSegIdx = segmentIndex;
      }
    }
  }

  return {
    segStart: allRings[nearestRingIdx]?.[nearestSegIdx],
    segEnd: allRings[nearestRingIdx]?.[nearestSegIdx + 1],
  };
}

function findClosestDistanceToSegment(
  candidatePoly: GeoJSON.Polygon,
  segStart: number[],
  segEnd: number[],
) {
  const segmentLine = turf.lineString([segStart, segEnd]);
  let closestDist = Infinity;

  for (const coord of candidatePoly.coordinates[0]) {
    const point = turf.point(coord);
    const nearest = turf.nearestPointOnLine(segmentLine, point);
    const distance = turf.distance(point, nearest, { units: 'meters' });
    if (distance < closestDist) {
      closestDist = distance;
    }
  }

  return closestDist;
}

function resolveNearestAlignedRotation(edgeAngle: number, currentRotation: number) {
  const normalizedCurrentRotation = normalizeAngle(currentRotation);
  const rotationCandidates = [edgeAngle, edgeAngle + 90, edgeAngle + 180, edgeAngle + 270].map(
    (angle) => normalizeAngle(angle),
  );

  let bestRotation = normalizedCurrentRotation;
  let bestDiff = Infinity;

  for (const candidate of rotationCandidates) {
    const diff = smallestAngleDiff(candidate, normalizedCurrentRotation);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRotation = candidate;
    }
  }

  return bestRotation;
}

export function resolveAutoEdgeAlignedRotation({
  center,
  currentRotation,
  aduSize,
  aduAspectRatio,
  aduShapeType,
  currentLegDimensions,
  movementBoundary,
  buildableZoneGeojson,
}: ResolveAutoEdgeAlignedRotationArgs): number | null {
  const candidatePoly = generateAduPolygon(
    center,
    aduSize,
    aduAspectRatio,
    currentRotation,
    aduShapeType,
    currentLegDimensions,
  );
  if (!candidatePoly || !buildableZoneGeojson) {
    return null;
  }

  const buildableFeature = turf.feature(buildableZoneGeojson as unknown as GeoJSON.Geometry);
  const buildableLine = turf.polygonToLine(buildableFeature as any);
  const nearestToCenter = turf.nearestPointOnLine(
    buildableLine as any,
    turf.point([center.lng, center.lat]),
  );
  const centerSnapPt = nearestToCenter.geometry.coordinates;
  const allRings = collectAllRings(buildableZoneGeojson);
  const { segStart, segEnd } = findNearestSegment(allRings, centerSnapPt);
  if (!segStart || !segEnd) {
    return null;
  }

  const closestDist = findClosestDistanceToSegment(candidatePoly, segStart, segEnd);
  if (closestDist >= ALIGN_THRESHOLD_METERS) {
    return null;
  }

  const edgeBearing = turf.bearing(turf.point(segStart), turf.point(segEnd));
  const bestRotation = resolveNearestAlignedRotation(edgeBearing, currentRotation);
  const rotatedPoly = generateAduPolygon(
    center,
    aduSize,
    aduAspectRatio,
    bestRotation,
    aduShapeType,
    currentLegDimensions,
  );
  if (!rotatedPoly) {
    return null;
  }

  if (movementBoundary && !isPolygonWithinZone(movementBoundary, rotatedPoly as any)) {
    return null;
  }

  return bestRotation;
}
