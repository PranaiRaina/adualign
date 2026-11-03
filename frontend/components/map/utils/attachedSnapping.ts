/**
 * attachedSnapping.ts — Pure functions for the 8 stages of attached ADU
 * wall-snapping logic. Each stage is a standalone, testable function.
 *
 * No React dependencies. All state is passed in via arguments.
 */

import * as turf from '@turf/turf';
import type { ShapeType, WallSegment, SnapResult, LegDimensions } from '../types';
import {
  ATTACHED_ACTIVE_FACE_PROXIMITY_METERS,
  ATTACHED_ACTIVE_FACE_MIN_DISTANCE_EPSILON_METERS,
  ATTACHED_CLEARANCE_BUFFER_METERS,
  ATTACHED_PUSH_SWEEP_STEP_METERS,
  ATTACHED_PUSH_BINARY_ITERS,
  ATTACHED_PUSH_MAX_SWEEP_METERS,
  ATTACHED_SLIDE_LOCAL_MAX_METERS,
  ATTACHED_SLIDE_STEP_METERS,
  ATTACHED_SLIDE_MIN_GAIN_TO_MOVE,
  ATTACHED_SLIDE_MAX_FOR_SMALL_GAIN_METERS,
  ATTACHED_CONTACT_THRESHOLD_METERS,
  ATTACHED_CONTACT_VERTEX_BAND_METERS,
  FOUR_FEET_METERS,
  SIX_FEET_METERS,
  METERS_PER_DEGREE_LAT,
  ATTACHED_SNAP_PROBE_DISTANCE_KM,
} from '../constants';
import {
  normalizeAngle,
  smallestAngleDiff,
  extractWallSegments,
  generateAduPolygon,
  translateCoordsByMeters,
  translateCenterByMeters,
} from './geometry';

/* ------------------------------------------------------------------ */
/*  Shared internal types                                              */
/* ------------------------------------------------------------------ */

export type ActiveWallFace = {
  segment: WallSegment;
  minDistanceMeters: number;
  outwardEastUnit: number;
  outwardNorthUnit: number;
};

export interface SnapContext {
  primaryGeom: GeoJSON.Geometry;
  primaryFeature: ReturnType<typeof turf.feature>;
  wallSegments: WallSegment[];
  dropPoint: ReturnType<typeof turf.point>;
}

export interface PushResult {
  minimumPush: number;
  pushedCoords: number[][];
  outwardBearing: number;
  outwardEastUnit: number;
  outwardNorthUnit: number;
  dominantWallFace: ActiveWallFace;
  activeWallFaces: ActiveWallFace[];
}

export interface SlideResult {
  bestSlideOffset: number;
  bestSlideScore: number;
  baseSlideScore: number;
  wallUnitEast: number;
  wallUnitNorth: number;
  activeVertexIndices: number[];
  concaveVertexIndices: Set<number>;
  minAnchorVertexDistance: number;
}

/* ------------------------------------------------------------------ */
/*  Stage 1 — lock rotation from nearest wall segment to drop center  */
/* ------------------------------------------------------------------ */

export function lockRotationFromNearestWall(
  ctx: SnapContext,
  currentAduRotation: number,
): { bestRotation: number; nearestDropSegment: WallSegment } | null {
  let nearestDropSegment: WallSegment | null = null;
  let nearestDropDistance = Infinity;
  for (const segment of ctx.wallSegments) {
    const nearest = turf.nearestPointOnLine(
      turf.lineString([segment.start, segment.end]),
      ctx.dropPoint,
    );
    const d = turf.distance(ctx.dropPoint, nearest, { units: 'meters' });
    if (d < nearestDropDistance) {
      nearestDropDistance = d;
      nearestDropSegment = segment;
    }
  }
  if (!nearestDropSegment) return null;

  const wallBearing = turf.bearing(
    turf.point(nearestDropSegment.start),
    turf.point(nearestDropSegment.end),
  );
  const candidates = [wallBearing, wallBearing + 90, wallBearing + 180, wallBearing + 270].map(
    (angle) => normalizeAngle(angle),
  );
  let bestRotation = normalizeAngle(currentAduRotation);
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const diff = smallestAngleDiff(candidate, currentAduRotation);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRotation = candidate;
    }
  }

  return { bestRotation, nearestDropSegment };
}

/* ------------------------------------------------------------------ */
/*  Stage 3 — true contact anchor from ADU edges against wall segments */
/* ------------------------------------------------------------------ */

export interface AnchorResult {
  aduAnchor: number[];
  wallAnchor: number[];
  anchorSegment: WallSegment;
  bestAnchorDistance: number;
  aduSurfaceCandidates: number[][];
}

export function findContactAnchor(
  ring: number[][],
  wallSegments: WallSegment[],
): AnchorResult | null {
  let bestAnchorDistance = Infinity;
  let aduAnchor: number[] | null = null;
  let wallAnchor: number[] | null = null;
  let anchorSegment: WallSegment | null = null;
  const aduSurfaceCandidates: number[][] = [];

  for (let i = 0; i < ring.length - 1; i++) {
    const aduEdgeStart = ring[i];
    const aduEdgeEnd = ring[i + 1];
    const aduEdgeLine = turf.lineString([aduEdgeStart, aduEdgeEnd]);
    aduSurfaceCandidates.push(aduEdgeStart, aduEdgeEnd);

    for (const segment of wallSegments) {
      // Candidates from ADU edge endpoints to wall segment
      {
        const aduPoint = turf.point(aduEdgeStart);
        const nearestOnWall = turf.nearestPointOnLine(
          turf.lineString([segment.start, segment.end]),
          aduPoint,
        );
        const nearestCoord = nearestOnWall.geometry.coordinates;
        const d = turf.distance(aduPoint, nearestOnWall, { units: 'meters' });
        if (d < bestAnchorDistance) {
          bestAnchorDistance = d;
          aduAnchor = aduEdgeStart;
          wallAnchor = nearestCoord;
          anchorSegment = segment;
        }
      }
      {
        const aduPoint = turf.point(aduEdgeEnd);
        const nearestOnWall = turf.nearestPointOnLine(
          turf.lineString([segment.start, segment.end]),
          aduPoint,
        );
        const nearestCoord = nearestOnWall.geometry.coordinates;
        const d = turf.distance(aduPoint, nearestOnWall, { units: 'meters' });
        if (d < bestAnchorDistance) {
          bestAnchorDistance = d;
          aduAnchor = aduEdgeEnd;
          wallAnchor = nearestCoord;
          anchorSegment = segment;
        }
      }

      // Candidates from wall endpoints projected onto ADU edge
      for (const wallEnd of [segment.start, segment.end]) {
        const wallEndPoint = turf.point(wallEnd);
        const nearestOnAduEdge = turf.nearestPointOnLine(aduEdgeLine, wallEndPoint);
        const aduPointCoord = nearestOnAduEdge.geometry.coordinates;
        aduSurfaceCandidates.push(aduPointCoord);
        const aduPoint = turf.point(aduPointCoord);
        const nearestOnWall = turf.nearestPointOnLine(
          turf.lineString([segment.start, segment.end]),
          aduPoint,
        );
        const nearestCoord = nearestOnWall.geometry.coordinates;
        const d = turf.distance(aduPoint, nearestOnWall, { units: 'meters' });
        if (d < bestAnchorDistance) {
          bestAnchorDistance = d;
          aduAnchor = aduPointCoord;
          wallAnchor = nearestCoord;
          anchorSegment = segment;
        }
      }
    }
  }
  if (!aduAnchor || !wallAnchor || !anchorSegment) return null;

  return { aduAnchor, wallAnchor, anchorSegment, bestAnchorDistance, aduSurfaceCandidates };
}

/* ------------------------------------------------------------------ */
/*  Stage 4 — translate center so ADU anchor touches wall anchor       */
/* ------------------------------------------------------------------ */

export function computeFlushPosition(
  targetLng: number,
  targetLat: number,
  wallAnchor: number[],
  aduAnchor: number[],
  currentAduSize: number,
  currentAduAspectRatio: number,
  bestRotation: number,
  currentAduShapeType: ShapeType,
  legDimensions?: import('../types').LegDimensions[keyof import('../types').LegDimensions],
): { flushCenter: { lng: number; lat: number }; flushPoly: GeoJSON.Polygon } | null {
  const flushCenter = {
    lng: targetLng + (wallAnchor[0] - aduAnchor[0]),
    lat: targetLat + (wallAnchor[1] - aduAnchor[1]),
  };
  const flushPoly = generateAduPolygon(
    flushCenter,
    currentAduSize,
    currentAduAspectRatio,
    bestRotation,
    currentAduShapeType,
    legDimensions,
  );
  if (!flushPoly) return null;

  return { flushCenter, flushPoly };
}

/* ------------------------------------------------------------------ */
/*  Stage 5 — resolve active wall faces and composite outward normal   */
/* ------------------------------------------------------------------ */

export function resolveActiveWallFaces(
  wallSegments: WallSegment[],
  aduSurfaceCandidates: number[][],
  anchorSegment: WallSegment,
  primaryFeature: ReturnType<typeof turf.feature>,
): {
  activeWallFaces: ActiveWallFace[];
  dominantWallFace: ActiveWallFace;
  outwardEastUnit: number;
  outwardNorthUnit: number;
  outwardBearing: number;
} {
  const probeDistanceKm = ATTACHED_SNAP_PROBE_DISTANCE_KM; // ~3 cm
  const primaryCentroid = turf.centroid(primaryFeature as any);

  const resolveOutwardBearing = (segment: WallSegment, probeOrigin: number[]) => {
    const segmentBearing = turf.bearing(turf.point(segment.start), turf.point(segment.end));
    const normal1 = normalizeAngle(segmentBearing + 90);
    const normal2 = normalizeAngle(segmentBearing - 90);
    const probe1 = turf.destination(turf.point(probeOrigin), probeDistanceKm, normal1);
    const probe2 = turf.destination(turf.point(probeOrigin), probeDistanceKm, normal2);
    const probe1Inside = turf.booleanPointInPolygon(probe1, primaryFeature as any);
    const probe2Inside = turf.booleanPointInPolygon(probe2, primaryFeature as any);
    if (probe1Inside && !probe2Inside) return normal2;
    if (probe2Inside && !probe1Inside) return normal1;
    const d1 = turf.distance(probe1, primaryCentroid, { units: 'meters' });
    const d2 = turf.distance(probe2, primaryCentroid, { units: 'meters' });
    return d1 > d2 ? normal1 : normal2;
  };

  const buildActiveFace = (segment: WallSegment): ActiveWallFace => {
    const segmentLine = turf.lineString([segment.start, segment.end]);
    let minDistanceMeters = Infinity;
    let nearestCoord = segment.start;
    for (const candidate of aduSurfaceCandidates) {
      const nearest = turf.nearestPointOnLine(segmentLine as any, turf.point(candidate));
      const d = turf.distance(turf.point(candidate), nearest, { units: 'meters' });
      if (d < minDistanceMeters) {
        minDistanceMeters = d;
        nearestCoord = nearest.geometry.coordinates;
      }
    }
    const outwardBearingVal = resolveOutwardBearing(segment, nearestCoord);
    const theta = (outwardBearingVal * Math.PI) / 180;
    return {
      segment,
      minDistanceMeters,
      outwardEastUnit: Math.sin(theta),
      outwardNorthUnit: Math.cos(theta),
    };
  };

  const activeWallFaces = wallSegments
    .map((segment) => buildActiveFace(segment))
    .filter((face) => face.minDistanceMeters <= ATTACHED_ACTIVE_FACE_PROXIMITY_METERS);

  if (!activeWallFaces.some((face) => face.segment === anchorSegment)) {
    activeWallFaces.push(buildActiveFace(anchorSegment));
  }

  let dominantWallFace = activeWallFaces[0];
  for (const face of activeWallFaces) {
    if (face.minDistanceMeters < dominantWallFace.minDistanceMeters) {
      dominantWallFace = face;
    }
  }

  let outwardEastUnit = 0;
  let outwardNorthUnit = 0;
  for (const face of activeWallFaces) {
    const weight =
      1 / Math.max(face.minDistanceMeters, ATTACHED_ACTIVE_FACE_MIN_DISTANCE_EPSILON_METERS);
    outwardEastUnit += face.outwardEastUnit * weight;
    outwardNorthUnit += face.outwardNorthUnit * weight;
  }
  const compositeLen = Math.hypot(outwardEastUnit, outwardNorthUnit);
  if (compositeLen > 1e-9) {
    outwardEastUnit /= compositeLen;
    outwardNorthUnit /= compositeLen;
  } else {
    outwardEastUnit = dominantWallFace.outwardEastUnit;
    outwardNorthUnit = dominantWallFace.outwardNorthUnit;
  }
  const outwardBearing = normalizeAngle(
    (Math.atan2(outwardEastUnit, outwardNorthUnit) * 180) / Math.PI,
  );

  return { activeWallFaces, dominantWallFace, outwardEastUnit, outwardNorthUnit, outwardBearing };
}

/* ------------------------------------------------------------------ */
/*  Stage 6 — push outward until clear, binary search minimum push     */
/* ------------------------------------------------------------------ */

export function pushOutwardUntilClear(
  flushPoly: GeoJSON.Polygon,
  outwardEastUnit: number,
  outwardNorthUnit: number,
  primaryFeature: ReturnType<typeof turf.feature>,
): { minimumPush: number; pushedCoords: number[][] } | null {
  const flushCoords = flushPoly.coordinates[0].map(([lng, lat]) => [lng, lat]);
  const maxPushSearch = ATTACHED_PUSH_MAX_SWEEP_METERS;

  let lastIntersectingPush = 0;
  let firstClearPush: number | null = null;
  for (let push = 0; push <= maxPushSearch; push += ATTACHED_PUSH_SWEEP_STEP_METERS) {
    const translatedCoords = translateCoordsByMeters(
      flushCoords,
      outwardEastUnit * push,
      outwardNorthUnit * push,
    );
    const translatedPoly = turf.polygon([translatedCoords]);
    const intersects = turf.booleanIntersects(translatedPoly as any, primaryFeature as any);
    if (!intersects) {
      firstClearPush = push;
      break;
    }
    lastIntersectingPush = push;
  }
  if (firstClearPush === null) return null;

  let lo = lastIntersectingPush;
  let hi = firstClearPush;
  for (let i = 0; i < ATTACHED_PUSH_BINARY_ITERS; i++) {
    const mid = (lo + hi) / 2;
    const translatedCoords = translateCoordsByMeters(
      flushCoords,
      outwardEastUnit * mid,
      outwardNorthUnit * mid,
    );
    const translatedPoly = turf.polygon([translatedCoords]);
    const intersects = turf.booleanIntersects(translatedPoly as any, primaryFeature as any);
    if (intersects) lo = mid;
    else hi = mid;
  }

  const minimumPush = hi + ATTACHED_CLEARANCE_BUFFER_METERS;
  const pushedCoords = translateCoordsByMeters(
    flushCoords,
    outwardEastUnit * minimumPush,
    outwardNorthUnit * minimumPush,
  );

  return { minimumPush, pushedCoords };
}

/* ------------------------------------------------------------------ */
/*  Stage 7 — slide along wall axis of dominant active wall face       */
/* ------------------------------------------------------------------ */

export function slideAlongWall(
  dominantWallFace: ActiveWallFace,
  flushPoly: GeoJSON.Polygon,
  wallSegments: WallSegment[],
  pushedCoords: number[][],
  pushedCenter: { lng: number; lat: number },
  dropPoint: ReturnType<typeof turf.point>,
): SlideResult {
  const slideSegment = dominantWallFace.segment;
  const segMidLat = (slideSegment.start[1] + slideSegment.end[1]) / 2;
  const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.cos((segMidLat * Math.PI) / 180);
  const segEast = (slideSegment.end[0] - slideSegment.start[0]) * metersPerDegLng;
  const segNorth = (slideSegment.end[1] - slideSegment.start[1]) * METERS_PER_DEGREE_LAT;
  const segLen = Math.hypot(segEast, segNorth) || 1;
  const wallUnitEast = segEast / segLen;
  const wallUnitNorth = segNorth / segLen;

  // Build a "contact-side" vertex set from the anchored wall segment so concave shapes
  // do not get dragged by unrelated outer vertices during along-wall optimization.
  const flushCoords = flushPoly.coordinates[0].map(([lng, lat]) => [lng, lat]);
  const anchoredSegLine = turf.lineString([slideSegment.start, slideSegment.end]);
  const flushVertices = flushCoords.slice(0, -1);
  let signedAreaCrossSum = 0;
  for (let i = 0; i < flushVertices.length; i++) {
    const a = flushVertices[i];
    const b = flushVertices[(i + 1) % flushVertices.length];
    signedAreaCrossSum += a[0] * b[1] - b[0] * a[1];
  }
  const winding = signedAreaCrossSum >= 0 ? 1 : -1;
  const concaveVertexIndices = new Set<number>();
  for (let i = 0; i < flushVertices.length; i++) {
    const prev = flushVertices[(i - 1 + flushVertices.length) % flushVertices.length];
    const curr = flushVertices[i];
    const next = flushVertices[(i + 1) % flushVertices.length];
    const ux = curr[0] - prev[0];
    const uy = curr[1] - prev[1];
    const vx = next[0] - curr[0];
    const vy = next[1] - curr[1];
    const cross = ux * vy - uy * vx;
    if (cross * winding < 0) concaveVertexIndices.add(i);
  }
  const anchorVertexDistances = flushVertices.map((coord) => {
    const pt = turf.point(coord);
    const nearest = turf.nearestPointOnLine(anchoredSegLine as any, pt);
    return turf.distance(pt, nearest, { units: 'meters' });
  });
  const minAnchorVertexDistance = Math.min(...anchorVertexDistances);
  const contactBand = minAnchorVertexDistance + ATTACHED_CONTACT_VERTEX_BAND_METERS;
  let activeVertexIndices = anchorVertexDistances
    .map((distance, idx) => (distance <= contactBand ? idx : -1))
    .filter((idx) => idx >= 0);
  if (activeVertexIndices.length < 2) {
    activeVertexIndices = flushVertices.map((_, idx) => idx);
  }

  const scorePosition = (coords: number[][]) => {
    let score = 0;
    const uniqueVertices = coords.slice(0, -1);
    for (const idx of activeVertexIndices) {
      const vertex = uniqueVertices[idx];
      const vertexPt = turf.point(vertex);
      let nearSegments = 0;
      for (const segment of wallSegments) {
        const nearest = turf.nearestPointOnLine(
          turf.lineString([segment.start, segment.end]),
          vertexPt,
        );
        const d = turf.distance(vertexPt, nearest, { units: 'meters' });
        if (d <= ATTACHED_CONTACT_THRESHOLD_METERS) nearSegments += 1;
      }

      if (nearSegments > 0) {
        // Base contact contribution for any vertex.
        score += 1;
        // Corner-priority bonus applies ONLY to inside (concave) corners.
        if (nearSegments > 1 && concaveVertexIndices.has(idx)) {
          score += nearSegments - 1;
        }
      }
    }
    return score;
  };

  let bestSlideOffset = 0;
  const baseSlideScore = scorePosition(pushedCoords);
  let bestSlideScore = baseSlideScore;
  let bestTieDistance = turf.distance(dropPoint, turf.point([pushedCenter.lng, pushedCenter.lat]), {
    units: 'meters',
  });

  // Closest valid attachment is the primary objective.
  // We only allow a very local slide window to avoid perceptible drift from the drop point.
  for (
    let slide = -ATTACHED_SLIDE_LOCAL_MAX_METERS;
    slide <= ATTACHED_SLIDE_LOCAL_MAX_METERS;
    slide += ATTACHED_SLIDE_STEP_METERS
  ) {
    const slidCoords = translateCoordsByMeters(
      pushedCoords,
      wallUnitEast * slide,
      wallUnitNorth * slide,
    );
    const score = scorePosition(slidCoords);
    const slidCenter = translateCenterByMeters(
      pushedCenter,
      wallUnitEast * slide,
      wallUnitNorth * slide,
    );
    const centerDistToDrop = turf.distance(
      dropPoint,
      turf.point([slidCenter.lng, slidCenter.lat]),
      { units: 'meters' },
    );
    // Prefer highest score, but for ties stick closest to where the user released.
    if (
      score > bestSlideScore ||
      (score === bestSlideScore && centerDistToDrop < bestTieDistance)
    ) {
      bestSlideScore = score;
      bestTieDistance = centerDistToDrop;
      bestSlideOffset = slide;
    }
  }

  // Keep zero-offset unless the local gain is meaningful.
  const slideScoreGain = bestSlideScore - baseSlideScore;
  if (
    slideScoreGain < ATTACHED_SLIDE_MIN_GAIN_TO_MOVE ||
    (slideScoreGain === 1 && Math.abs(bestSlideOffset) > ATTACHED_SLIDE_MAX_FOR_SMALL_GAIN_METERS)
  ) {
    bestSlideOffset = 0;
    bestSlideScore = baseSlideScore;
  }

  return {
    bestSlideOffset,
    bestSlideScore,
    baseSlideScore,
    wallUnitEast,
    wallUnitNorth,
    activeVertexIndices,
    concaveVertexIndices,
    minAnchorVertexDistance,
  };
}

/* ------------------------------------------------------------------ */
/*  Stage 8 — validate final position                                  */
/* ------------------------------------------------------------------ */

export function validateFinalPosition(
  finalCoords: number[][],
  finalPoly: ReturnType<typeof turf.polygon>,
  result: {
    property_geojson?: unknown;
    detected_buildings?: unknown[];
  },
  disabledBuildings: Set<number>,
  reachableSecondaryIndices: number[] | null,
): boolean {
  let isValid = true;

  if (result?.property_geojson) {
    const propertyFeature = turf.feature(result.property_geojson as unknown as GeoJSON.Geometry);
    const propertyLine = turf.polygonToLine(propertyFeature as any);
    for (const coord of finalCoords.slice(0, -1)) {
      const pt = turf.point(coord);
      const insideProperty = turf.booleanPointInPolygon(pt, propertyFeature as any);
      if (!insideProperty) {
        isValid = false;
        break;
      }
      const nearest = turf.nearestPointOnLine(propertyLine as any, pt);
      const distMeters = turf.distance(pt, nearest, { units: 'meters' });
      if (distMeters < FOUR_FEET_METERS) {
        isValid = false;
        break;
      }
    }
  }

  if (isValid && result?.detected_buildings && result.detected_buildings.length > 1) {
    const indicesToCheck =
      reachableSecondaryIndices ??
      Array.from({ length: result.detected_buildings.length - 1 }, (_, idx) => idx + 1);
    for (const i of indicesToCheck) {
      if (disabledBuildings.has(i)) continue;
      const secondary = turf.feature(result.detected_buildings[i] as unknown as GeoJSON.Geometry);
      // Respect the same 6ft (1.8288m) secondary-structure setback used by buildable-zone logic.
      const bufferedSecondary = turf.buffer(secondary, SIX_FEET_METERS, { units: 'meters' });
      if (turf.booleanIntersects(finalPoly as any, bufferedSecondary as any)) {
        isValid = false;
        break;
      }
    }
  }

  return isValid;
}
