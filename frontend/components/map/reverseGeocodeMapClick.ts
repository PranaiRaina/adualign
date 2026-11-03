type ReverseGeocodeResult = {
  features?: Array<{
    geometry?: {
      coordinates?: [number, number];
    };
    properties?: {
      full_address?: string;
      name?: string;
    };
  }>;
};

const FALLBACK_SELECTED_LOCATION_NAME = 'Selected Map Location';

export type ReverseGeocodedLocation = {
  lat: number;
  lng: number;
  name: string;
};

export async function reverseGeocodeMapClick({
  lng,
  lat,
  accessToken,
}: {
  lng: number;
  lat: number;
  accessToken: string;
}): Promise<ReverseGeocodedLocation> {
  const fallbackLocation = { lat, lng, name: FALLBACK_SELECTED_LOCATION_NAME };

  try {
    const response = await fetch(
      `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${accessToken}`,
    );

    if (!response.ok) {
      return fallbackLocation;
    }

    const data = (await response.json()) as ReverseGeocodeResult;
    const feature = data.features?.[0];
    const [resolvedLng = lng, resolvedLat = lat] = feature?.geometry?.coordinates ?? [];
    const resolvedName =
      feature?.properties?.full_address ??
      feature?.properties?.name ??
      FALLBACK_SELECTED_LOCATION_NAME;

    return { lat: resolvedLat, lng: resolvedLng, name: resolvedName };
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return fallbackLocation;
  }
}
