import * as turf from '@turf/turf';

/**
 * Build midpoint labels for each exterior wall of a building footprint that is
 * at least `minWallFt` long. Derived from data already on the client; nothing
 * is fetched or persisted. Returns an empty collection for non-polygon input.
 */
export function buildWallLengthLabels(
  geometry: GeoJSON.Geometry | null | undefined,
  minWallFt: number,
): GeoJSON.FeatureCollection {
  const ring = largestExteriorRing(geometry);
  if (!ring) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const start = ring[i];
    const end = ring[i + 1];
    const lengthFt = turf.distance(start, end, { units: 'feet' });
    if (lengthFt < minWallFt) {
      continue;
    }
    const mid = turf.midpoint(start, end);
    features.push({
      type: 'Feature',
      geometry: mid.geometry,
      properties: { label: `${Math.round(lengthFt)} ft` },
    });
  }

  return { type: 'FeatureCollection', features };
}

function largestExteriorRing(
  geometry: GeoJSON.Geometry | null | undefined,
): GeoJSON.Position[] | null {
  if (!geometry) return null;

  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ?? null;
  }

  if (geometry.type === 'MultiPolygon') {
    let bestRing: GeoJSON.Position[] | null = null;
    let bestArea = -Infinity;
    for (const polygon of geometry.coordinates) {
      const ring = polygon[0];
      if (!ring) continue;
      const area = turf.area(turf.polygon([ring]));
      if (area > bestArea) {
        bestArea = area;
        bestRing = ring;
      }
    }
    return bestRing;
  }

  return null;
}
