import * as turf from '@turf/turf';
import { METERS_TO_FEET } from '../constants';

export type AduBboxDimensions = {
  widthFt: number;
  lengthFt: number;
};

/**
 * Returns the rotation-invariant ADU footprint bounding box in feet.
 */
export function getAduBboxDimensionValues(
  polygon: GeoJSON.Polygon,
  rotationDegrees: number,
): AduBboxDimensions {
  const polygonFeature = turf.polygon(polygon.coordinates);
  const pivot = turf.centroid(polygonFeature);
  const normalizedFeature = turf.transformRotate(polygonFeature, -rotationDegrees, { pivot });
  const bbox = turf.bbox(normalizedFeature);
  return {
    widthFt:
      turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' }) * METERS_TO_FEET,
    lengthFt:
      turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' }) * METERS_TO_FEET,
  };
}

/**
 * Returns width x height as a string without the unit (e.g. "14.2 x 25.8").
 * Rotation-invariant for all shape types by first normalizing the polygon
 * back to its unrotated local frame, then measuring its axis-aligned bbox.
 */
export function getAduBboxDimensions(polygon: GeoJSON.Polygon, rotationDegrees: number): string {
  const { widthFt, lengthFt } = getAduBboxDimensionValues(polygon, rotationDegrees);
  return `${widthFt.toFixed(1)} × ${lengthFt.toFixed(1)}`;
}
