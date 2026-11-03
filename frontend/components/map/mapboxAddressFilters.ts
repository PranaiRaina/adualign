import { CALIFORNIA_REGION_CODE, CALIFORNIA_REGION_NAME } from './constants';

type MapboxRegionContext = {
  name?: string;
  region_code?: string;
};

export type MapboxAddressFeature = {
  geometry?: {
    coordinates?: number[];
  };
  properties?: {
    context?: {
      region?: MapboxRegionContext;
    };
    full_address?: string;
    name?: string;
  };
};

export function isCaliforniaAddressFeature(feature: MapboxAddressFeature | null | undefined) {
  const region = feature?.properties?.context?.region;

  return region?.region_code === CALIFORNIA_REGION_CODE || region?.name === CALIFORNIA_REGION_NAME;
}

export function getMapboxFeatureCoordinates(
  feature: MapboxAddressFeature | null | undefined,
): [number, number] | null {
  const [lng, lat] = feature?.geometry?.coordinates ?? [];

  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return null;
  }

  return [lng, lat];
}

export function getMapboxFeaturePlaceName(feature: MapboxAddressFeature, fallbackName: string) {
  return feature.properties?.full_address ?? feature.properties?.name ?? fallbackName;
}
