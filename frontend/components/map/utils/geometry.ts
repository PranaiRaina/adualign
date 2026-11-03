/**
 * Pure geometry utility functions for ADU polygon generation
 * and coordinate manipulation. No React dependencies.
 */

import * as turf from '@turf/turf';
import type { ShapeType, WallSegment, Point2D } from '../types';
import {
  METERS_PER_DEGREE_LAT,
  ADU_GENERATION_BASE_SCALE_METERS,
  SQFT_TO_SQM,
  DEFAULT_LEG_DIMENSIONS,
} from '../constants';

/* ------------------------------------------------------------------ */
/*  Basic math helpers                                                 */
/* ------------------------------------------------------------------ */

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const normalizeVector = (v: Point2D) => {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
};

export const dot = (a: Point2D, b: Point2D) => a.x * b.x + a.y * b.y;

export const fromTo = (a: Point2D, b: Point2D): Point2D => ({
  x: b.x - a.x,
  y: b.y - a.y,
});

export const pointInPolygon2D = (point: Point2D, polygon: Point2D[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

export const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

export const smallestAngleDiff = (a: number, b: number) => {
  let diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  if (diff > 180) diff = 360 - diff;
  return diff;
};

/**
 * Maps a handle's visual angle (after object rotation) to the nearest 45-degree browser cursor.
 *
 * Standard cursors:
 * - ns-resize: North/South (0° or 180°)
 * - ew-resize: East/West (90° or 270°)
 * - nwse-resize: NW/SE (315° or 135°)
 * - nesw-resize: NE/SW (45° or 225°)
 */
export function getRotatedCursor(baseAngle: number, rotation: number): string {
  const totalAngle = normalizeAngle(baseAngle + rotation);
  // Map to 0-180 for simplicity since resize cursors are bidirectional
  const normalized = totalAngle % 180;

  if (normalized < 22.5 || normalized >= 157.5) return 'ns-resize';
  if (normalized < 67.5) return 'nesw-resize';
  if (normalized < 112.5) return 'ew-resize';
  if (normalized < 157.5) return 'nwse-resize';
  return 'ns-resize';
}

/* ------------------------------------------------------------------ */
/*  Wall & coordinate helpers                                          */
/* ------------------------------------------------------------------ */

export const extractWallSegments = (geometry: GeoJSON.Geometry): WallSegment[] => {
  const segments: WallSegment[] = [];
  const pushRingSegments = (ring: number[][]) => {
    for (let i = 0; i < ring.length - 1; i++) {
      const start = ring[i];
      const end = ring[i + 1];
      if (start[0] === end[0] && start[1] === end[1]) continue;
      segments.push({ start, end });
    }
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates as number[][][]) pushRingSegments(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates as number[][][][]) {
      for (const ring of poly) pushRingSegments(ring);
    }
  }
  return segments;
};

export const translateCoordsByMeters = (
  coords: number[][],
  eastMeters: number,
  northMeters: number,
) => {
  return coords.map(([lng, lat]) => {
    const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
    const safeMetersPerDegLng = Math.abs(metersPerDegLng) < 1e-6 ? 1e-6 : metersPerDegLng;
    return [lng + eastMeters / safeMetersPerDegLng, lat + northMeters / METERS_PER_DEGREE_LAT];
  });
};

export const translateCenterByMeters = (
  center: { lng: number; lat: number },
  eastMeters: number,
  northMeters: number,
) => {
  const distanceMeters = Math.hypot(eastMeters, northMeters);
  if (distanceMeters < 1e-9) return center;
  const bearing = (Math.atan2(eastMeters, northMeters) * 180) / Math.PI;
  const moved = turf.destination(
    turf.point([center.lng, center.lat]),
    distanceMeters / 1000,
    bearing,
    { units: 'kilometers' },
  );
  return {
    lng: moved.geometry.coordinates[0],
    lat: moved.geometry.coordinates[1],
  };
};

/** Extract all rings (exterior + holes) for the largest polygon in a geometry. */
export const getLargestPolyRings = (geojsonGeometry: GeoJSON.Geometry): number[][][] | null => {
  if (geojsonGeometry.type === 'Polygon') {
    return geojsonGeometry.coordinates;
  } else if (geojsonGeometry.type === 'MultiPolygon') {
    let maxArea = -1;
    let bestPoly: number[][][] | null = null;
    for (const poly of geojsonGeometry.coordinates) {
      const area = turf.area(turf.polygon(poly as any));
      if (area > maxArea) {
        maxArea = area;
        bestPoly = poly;
      }
    }
    return bestPoly;
  }
  return null;
};

/* ------------------------------------------------------------------ */
/*  ADU Polygon Generation                                             */
/* ------------------------------------------------------------------ */

/**
 * Computes the ratio of actual geometric footprint to the unscaled bounding box area.
 * Required to allow independent leg resizing without collapsing/scaling the outer geometry box.
 *
 * @param shapeType - The physical profile of the ADU.
 * @param legDims - The user's active custom leg constraints.
 * @returns The raw percentage [0.0, 1.0] of area natively inhabited by the shape interior.
 */
export function getShapeAreaRatio(
  shapeType: import('../types').ShapeType,
  legDims?: import('../types').LegDimensions[keyof import('../types').LegDimensions],
): number {
  if (shapeType === 'rectangle') return 1.0;

  if (shapeType === 'l-shape') {
    const d = legDims as import('../types').LegDimensions['l-shape'];
    const tx = d?.tX ?? DEFAULT_LEG_DIMENSIONS['l-shape'].tX;
    const ty = d?.tY ?? DEFAULT_LEG_DIMENSIONS['l-shape'].tY;
    return tx + ty - tx * ty;
  }

  if (shapeType === 't-shape') {
    const d = legDims as import('../types').LegDimensions['t-shape'];
    const sw = d?.stemWidth ?? DEFAULT_LEG_DIMENSIONS['t-shape'].stemWidth;
    const cd = d?.crossbarDepth ?? DEFAULT_LEG_DIMENSIONS['t-shape'].crossbarDepth;
    return cd + sw * (1.0 - cd); // cd crossbar depth + (1-cd) stem depth
  }

  if (shapeType === 'u-shape') {
    const d = legDims as import('../types').LegDimensions['u-shape'];
    const cw = d?.cutoutWidth ?? DEFAULT_LEG_DIMENSIONS['u-shape'].cutoutWidth;
    const cd = d?.cutoutDepth ?? DEFAULT_LEG_DIMENSIONS['u-shape'].cutoutDepth;
    // Base is 1.0. Cutout is a rectangle of cw width and (1 - cd) depth.
    return 1.0 - cw * (1.0 - cd);
  }

  return 1.0;
}

/**
 * Generates a GeoJSON Polygon for the ADU based on its configuration.
 * Standalone pure function so we can preview a movement or rotation
 * before committing it to state (for boundary clamping).
 */
export function generateAduPolygon(
  center: { lng: number; lat: number },
  sizeSqFt: number,
  aspectRatio: number,
  rotationDegrees: number,
  shapeType: ShapeType,
  legDimensions?: import('../types').LegDimensions[keyof import('../types').LegDimensions],
): GeoJSON.Polygon | null {
  const baseW = aspectRatio;
  const baseL = 1.0;
  const baseHalfW = baseW / 2;
  const baseHalfL = baseL / 2;

  let localCoords: number[][] = [];
  if (shapeType === 'rectangle') {
    localCoords = [
      [baseHalfW, baseHalfL],
      [-baseHalfW, baseHalfL],
      [-baseHalfW, -baseHalfL],
      [baseHalfW, -baseHalfL],
      [baseHalfW, baseHalfL],
    ];
  } else if (shapeType === 'l-shape') {
    const dims =
      (legDimensions as import('../types').LegDimensions['l-shape']) ??
      DEFAULT_LEG_DIMENSIONS['l-shape'];
    const tX = baseW * dims.tX;
    const tY = baseL * dims.tY;

    const innerCornerX = -baseHalfW + tX;
    const innerCornerY = baseHalfL - tY;

    localCoords = [
      [baseHalfW, baseHalfL],
      [-baseHalfW, baseHalfL],
      [-baseHalfW, -baseHalfL],
      [innerCornerX, -baseHalfL],
      [innerCornerX, innerCornerY],
      [baseHalfW, innerCornerY],
      [baseHalfW, baseHalfL],
    ];
  } else if (shapeType === 't-shape') {
    const dims =
      (legDimensions as import('../types').LegDimensions['t-shape']) ??
      DEFAULT_LEG_DIMENSIONS['t-shape'];
    const stemW = baseW * dims.stemWidth;
    const crossbarDepth = baseL * dims.crossbarDepth;

    const stemHalfW = stemW / 2;

    localCoords = [
      [baseHalfW, baseHalfL],
      [-baseHalfW, baseHalfL],
      [-baseHalfW, baseHalfL - crossbarDepth],
      [-stemHalfW, baseHalfL - crossbarDepth],
      [-stemHalfW, -baseHalfL],
      [stemHalfW, -baseHalfL],
      [stemHalfW, baseHalfL - crossbarDepth],
      [baseHalfW, baseHalfL - crossbarDepth],
      [baseHalfW, baseHalfL],
    ];
  } else if (shapeType === 'u-shape') {
    const dims =
      (legDimensions as import('../types').LegDimensions['u-shape']) ??
      DEFAULT_LEG_DIMENSIONS['u-shape'];
    const cutW = baseW * dims.cutoutWidth;
    const cutD = baseL * dims.cutoutDepth;

    const cutHalfW = cutW / 2;
    const innerY = baseHalfL - cutD;

    localCoords = [
      [baseHalfW, baseHalfL],
      [-baseHalfW, baseHalfL],
      [-baseHalfW, -baseHalfL],
      [-cutHalfW, -baseHalfL],
      [-cutHalfW, innerY],
      [cutHalfW, innerY],
      [cutHalfW, -baseHalfL],
      [baseHalfW, -baseHalfL],
      [baseHalfW, baseHalfL],
    ];
  }

  const m = ADU_GENERATION_BASE_SCALE_METERS;
  const DEG_PER_METER_LAT = 1 / METERS_PER_DEGREE_LAT;
  const DEG_PER_METER_LNG = 1 / (METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180));

  const realCoords = localCoords.map((p) => [
    center.lng + p[0] * m * DEG_PER_METER_LNG,
    center.lat + p[1] * m * DEG_PER_METER_LAT,
  ]);
  const basePoly = turf.polygon([realCoords]);

  try {
    const targetAreaSqM = sizeSqFt * SQFT_TO_SQM;
    const currentAreaSqM = turf.area(basePoly);
    const scaleFactor = Math.sqrt(targetAreaSqM / currentAreaSqM);

    // Use the center as the origin for scaling so concave shapes don't "jump"
    let finalPoly = turf.transformScale(basePoly, scaleFactor, {
      origin: [center.lng, center.lat],
    });

    if (rotationDegrees !== 0) {
      finalPoly = turf.transformRotate(finalPoly, rotationDegrees, {
        pivot: [center.lng, center.lat],
      });
    }

    return finalPoly.geometry as GeoJSON.Polygon;
  } catch (e) {
    console.error('Failed to generate ADU polygon', e);
    return null;
  }
}
