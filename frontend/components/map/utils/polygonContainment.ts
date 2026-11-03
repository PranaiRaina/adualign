import * as turf from '@turf/turf';

import type { Feature, Geometry, Polygon, MultiPolygon } from 'geojson';

import { POLYGON_COVERAGE_THRESHOLD } from '../constants';

/** Zone may be any polygonal feature (e.g. turf.buffer output typed as Feature<Geometry>). */
type ZoneLike = Feature<Geometry> | Polygon | MultiPolygon;
type PolygonLike = Feature<Polygon> | Polygon;

const toFeature = (zone: ZoneLike): Feature<Geometry> =>
  zone.type === 'Feature' ? zone : turf.feature(zone);

export const polygonCoverageRatio = (zone: ZoneLike, polygon: PolygonLike): number => {
  const zoneFeature = toFeature(zone);
  const polygonFeature = polygon.type === 'Feature' ? polygon : turf.feature(polygon);
  const polygonArea = turf.area(polygonFeature);
  if (!Number.isFinite(polygonArea) || polygonArea <= 0) return 0;

  try {
    const intersection = turf.intersect(
      turf.featureCollection([zoneFeature as any, polygonFeature as any]),
    );
    if (!intersection) return 0;
    const insideArea = turf.area(intersection as any);
    if (!Number.isFinite(insideArea) || insideArea <= 0) return 0;
    return insideArea / polygonArea;
  } catch {
    // Fallback for edge-case topology failures inside turf.intersect.
    return turf.booleanContains(zoneFeature as any, polygonFeature as any) ? 1 : 0;
  }
};

export const isPolygonWithinZone = (
  zone: ZoneLike,
  polygon: PolygonLike,
  threshold = POLYGON_COVERAGE_THRESHOLD,
): boolean => polygonCoverageRatio(zone, polygon) >= threshold;
