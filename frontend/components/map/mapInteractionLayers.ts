import type { GeoJSONFeature } from 'mapbox-gl';

export const ADU_LAYER_ID = 'adu-fill';
export const ACTIVE_BUILDING_LAYER_IDS = ['building-exclusion-fill'] as const;
export const DISABLED_BUILDING_LAYER_IDS = [
  'building-disabled-fill',
  'building-disabled-outline',
] as const;
export const BUILDING_LAYER_IDS = [
  ...ACTIVE_BUILDING_LAYER_IDS,
  ...DISABLED_BUILDING_LAYER_IDS,
] as const;

type MapFeatureTarget = 'adu' | 'active-building' | 'disabled-building' | 'none';

function hasLayerFeature(
  features: GeoJSONFeature[] | undefined,
  layerIds: readonly string[],
): boolean {
  return (
    features?.some((feature) => {
      const layerId = feature.layer?.id;
      return !!layerId && layerIds.includes(layerId);
    }) ?? false
  );
}

export function isAduLayerFeature(features: GeoJSONFeature[] | undefined): boolean {
  return hasLayerFeature(features, [ADU_LAYER_ID]);
}

export function isBuildingLayerFeature(features: GeoJSONFeature[] | undefined): boolean {
  return hasLayerFeature(features, BUILDING_LAYER_IDS);
}

export function classifyMapFeatureTarget(features: GeoJSONFeature[] | undefined): MapFeatureTarget {
  if (isAduLayerFeature(features)) {
    return 'adu';
  }

  if (hasLayerFeature(features, ACTIVE_BUILDING_LAYER_IDS)) {
    return 'active-building';
  }

  if (hasLayerFeature(features, DISABLED_BUILDING_LAYER_IDS)) {
    return 'disabled-building';
  }

  return 'none';
}
