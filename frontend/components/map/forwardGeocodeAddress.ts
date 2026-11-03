import type { ReverseGeocodedLocation } from './reverseGeocodeMapClick';
import { CALIFORNIA_BBOX_PARAM } from './constants';
import {
  getMapboxFeatureCoordinates,
  getMapboxFeaturePlaceName,
  isCaliforniaAddressFeature,
  type MapboxAddressFeature,
} from './mapboxAddressFilters';

type ForwardGeocodeResult = { features?: MapboxAddressFeature[] };

export async function forwardGeocodeAddress({
  address,
  accessToken,
}: {
  address: string;
  accessToken: string;
}): Promise<ReverseGeocodedLocation | null> {
  try {
    const params = new URLSearchParams({
      access_token: accessToken,
      bbox: CALIFORNIA_BBOX_PARAM,
      country: 'US',
      limit: '1',
      q: address,
      types: 'address',
    });

    const response = await fetch(
      `https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ForwardGeocodeResult;
    const feature = data.features?.[0];
    if (!isCaliforniaAddressFeature(feature)) {
      return null;
    }

    const coordinates = getMapboxFeatureCoordinates(feature);
    if (!coordinates || !feature) {
      return null;
    }

    const [lng, lat] = coordinates;
    return {
      lng,
      lat,
      name: getMapboxFeaturePlaceName(feature, address),
    };
  } catch (error) {
    console.error('Forward geocoding failed:', error);
    return null;
  }
}
