'use client';

/**
 * AddressSearch — Mapbox SearchBox geocoder that flies the map to the
 * selected address. Uses @mapbox/search-js-react.
 */

import { useCallback } from 'react';
import { SearchBox } from '@mapbox/search-js-react';
import { CALIFORNIA_ADDRESS_ONLY_MESSAGE, CALIFORNIA_BBOX, IRVINE_CENTER } from './constants';
import {
  getMapboxFeatureCoordinates,
  getMapboxFeaturePlaceName,
  isCaliforniaAddressFeature,
  type MapboxAddressFeature,
} from './mapboxAddressFilters';

interface AddressSearchProps {
  accessToken: string;
  isDisabled?: boolean;
  onInvalidResult: (message: string) => void;
  onResult: (lng: number, lat: number, placeName: string) => void;
  onValueChange: (value: string) => void;
  value: string;
}

export default function AddressSearch({
  accessToken,
  isDisabled = false,
  onInvalidResult,
  onResult,
  onValueChange,
  value,
}: AddressSearchProps) {
  const handleChange = useCallback(
    (nextValue: string) => {
      if (isDisabled) {
        return;
      }
      onValueChange(nextValue);
    },
    [isDisabled, onValueChange],
  );

  const handleRetrieve = useCallback(
    (res: unknown) => {
      if (isDisabled) {
        return;
      }

      const feature = (res as { features?: MapboxAddressFeature[] })?.features?.[0];
      if (!feature) return;

      if (!isCaliforniaAddressFeature(feature)) {
        onInvalidResult(CALIFORNIA_ADDRESS_ONLY_MESSAGE);
        return;
      }

      const coordinates = getMapboxFeatureCoordinates(feature);
      if (!coordinates) return;

      const [lng, lat] = coordinates;
      const placeName = getMapboxFeaturePlaceName(feature, 'Selected location');
      onResult(lng, lat, placeName);
    },
    [isDisabled, onInvalidResult, onResult],
  );

  return (
    <div
      className={`absolute top-2 left-1/2 z-50 w-96 -translate-x-1/2 rounded-xl shadow-lg ${isDisabled ? 'pointer-events-none opacity-80' : ''}`}
      style={{
        // @ts-expect-error - Injecting variables for Shadow DOM penetration
        '--mapbox-search-box-text-color': '#0f172a',
        '--mapbox-search-box-input-text-color': '#0f172a',
        '--mapbox-search-box-suggestion-text-color': '#0f172a',
      }}
    >
      <SearchBox
        accessToken={accessToken}
        value={value}
        onChange={handleChange}
        onRetrieve={handleRetrieve}
        placeholder="Search for your address…"
        options={{
          bbox: CALIFORNIA_BBOX,
          country: 'US',
          proximity: [IRVINE_CENTER.longitude, IRVINE_CENTER.latitude], // Irvine bias
          types: 'address',
        }}
        theme={{
          variables: {
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            borderRadius: '12px',
            boxShadow: '0 10px 40px -10px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(0, 0, 0, 0.05)',
            colorBackground: '#ffffff',
            colorBackgroundActive: '#f8fafc',
            colorBackgroundHover: '#f1f5f9',
            colorText: '#0f172a',
            colorSecondary: '#64748b',
            colorPrimary: '#16a34a',
          },
        }}
      />
    </div>
  );
}
