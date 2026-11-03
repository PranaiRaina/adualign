import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

import type { AnalyzeResponse, GeoJSONGeometry } from '@/types';

import { DEFAULT_SEARCH_ZOOM, MAPBOX_TOKEN, MAP_SELECT_FLY_TO_DURATION_MS } from '../constants';
import { reverseGeocodeMapClick } from '../reverseGeocodeMapClick';
import type {
  AduAction,
  AddressSelectionOptions,
  MapLocation,
  RectangleShapeState,
  ShapeStateCache,
  ShapeType,
} from '../types';

type YardZones = {
  front_yard_geojson: GeoJSONGeometry | null;
  rear_yard_geojson: GeoJSONGeometry | null;
  side_yard_geojson: GeoJSONGeometry | null;
} | null;

type SelectedLocationOrigin = 'initial' | 'runtime';

interface UseMapInterfaceControllerParams {
  initialLocation?: MapLocation;
  mapRef: React.MutableRefObject<MapRef | null>;
  shapeStatesRef: React.MutableRefObject<ShapeStateCache>;
  initialRectangleStateRef: React.MutableRefObject<RectangleShapeState | null>;
  dispatch: React.Dispatch<AduAction>;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  initialAduShapeType?: ShapeType;
}

function createEmptyShapeStateCache(): ShapeStateCache {
  return {
    rectangle: null,
    'l-shape': null,
    't-shape': null,
    'u-shape': null,
  };
}

export function useMapInterfaceController({
  initialLocation,
  mapRef,
  shapeStatesRef,
  initialRectangleStateRef,
  dispatch,
  dispatchCenter,
  initialAduShapeType,
}: UseMapInterfaceControllerParams) {
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(
    initialLocation ?? null,
  );
  const [selectedLocationOrigin, setSelectedLocationOrigin] = useState<SelectedLocationOrigin>(
    initialLocation ? 'initial' : 'runtime',
  );
  const [autoAnalyzePending, setAutoAnalyzePending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [edgeSelectMode, setEdgeSelectMode] = useState(false);
  const [yardZones, setYardZones] = useState<YardZones>(null);
  const [showYardLabels, setShowYardLabels] = useState(false);
  const [aduShapeType, setAduShapeType] = useState<ShapeType>(initialAduShapeType ?? 'rectangle');
  const [autoEdgeAlign, setAutoEdgeAlign] = useState(false);
  const [autoPositionCorrection, setAutoPositionCorrection] = useState(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [hoveredBuildingIndex, setHoveredBuildingIndex] = useState(-1);
  const [attachedReachableSecondaryIndices, setAttachedReachableSecondaryIndices] = useState<
    number[]
  >([]);

  const resetDerivedMapState = useCallback(() => {
    setIsLoading(false);
    setResult(null);
    setError(null);
    setYardZones(null);
    setShowYardLabels(false);
    setEdgeSelectMode(false);
    setHoveredBuildingIndex(-1);
  }, []);

  const resetPlacementState = useCallback(() => {
    dispatchCenter(null);
    setAduShapeType('rectangle');
    setAutoPositionCorrection(true);
    setShowAdvancedSettings(false);
    shapeStatesRef.current = createEmptyShapeStateCache();
    initialRectangleStateRef.current = null;
  }, [dispatchCenter, initialRectangleStateRef, shapeStatesRef]);

  const restoreVisibleUiState = useCallback(() => {
    setUiVisible(true);
  }, []);

  const prepareForNewLocation = useCallback(() => {
    resetDerivedMapState();
    resetPlacementState();
    restoreVisibleUiState();
    dispatch({ type: 'SET_TYPE', aduType: 'detached' });
  }, [dispatch, resetDerivedMapState, resetPlacementState, restoreVisibleUiState]);

  const handleAddressResult = useCallback(
    (lng: number, lat: number, placeName: string, options?: AddressSelectionOptions) => {
      prepareForNewLocation();
      setSelectedLocation({ lat, lng, name: placeName });
      setSelectedLocationOrigin('runtime');
      setAutoAnalyzePending(options?.autoAnalyze ?? true);
      if (options?.flyTo !== false) {
        mapRef.current?.flyTo({
          center: [lng, lat],
          zoom: DEFAULT_SEARCH_ZOOM,
          duration: MAP_SELECT_FLY_TO_DURATION_MS,
        });
      }
    },
    [mapRef, prepareForNewLocation, setAutoAnalyzePending],
  );

  const handleMapClick = useCallback(
    async (
      e: { lngLat: { lng: number; lat: number } },
      options: { isDraggingAdu: boolean; isInteractionLocked: boolean },
    ) => {
      if (options.isDraggingAdu || options.isInteractionLocked || result) {
        return;
      }

      const { lng, lat } = e.lngLat;
      const resolvedLocation = await reverseGeocodeMapClick({
        lng,
        lat,
        accessToken: MAPBOX_TOKEN,
      });

      prepareForNewLocation();
      setSelectedLocation(resolvedLocation);
      setSelectedLocationOrigin('runtime');
      setAutoAnalyzePending(false);
    },
    [prepareForNewLocation, result, setAutoAnalyzePending],
  );

  const handleReset = useCallback(() => {
    resetDerivedMapState();
    resetPlacementState();
    restoreVisibleUiState();
    setSelectedLocation(null);
    setSelectedLocationOrigin('runtime');
    setAutoAnalyzePending(false);
    dispatch({ type: 'RESET' });
  }, [
    dispatch,
    resetDerivedMapState,
    resetPlacementState,
    restoreVisibleUiState,
    setAutoAnalyzePending,
  ]);

  const clearSelectedLocation = useCallback(() => {
    resetDerivedMapState();
    resetPlacementState();
    restoreVisibleUiState();
    setSelectedLocation(null);
    setSelectedLocationOrigin('runtime');
    setAutoAnalyzePending(false);
    dispatch({ type: 'RESET' });
  }, [
    dispatch,
    resetDerivedMapState,
    resetPlacementState,
    restoreVisibleUiState,
    setAutoAnalyzePending,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      event.preventDefault();
      setUiVisible((isVisible) => !isVisible);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    analysisState: {
      selectedLocation,
      selectedLocationOrigin,
      isLoading,
      result,
      error,
      setIsLoading,
      setResult,
      setError,
      autoAnalyzePending,
      setAutoAnalyzePending,
    },
    uiState: {
      uiVisible,
      edgeSelectMode,
      yardZones,
      showYardLabels,
      aduShapeType,
      autoEdgeAlign,
      autoPositionCorrection,
      showAdvancedSettings,
      hoveredBuildingIndex,
      attachedReachableSecondaryIndices,
      setUiVisible,
      setEdgeSelectMode,
      setYardZones,
      setShowYardLabels,
      setAduShapeType,
      setAutoEdgeAlign,
      setAutoPositionCorrection,
      setShowAdvancedSettings,
      setHoveredBuildingIndex,
      setAttachedReachableSecondaryIndices,
    },
    actions: {
      handleAddressResult,
      handleMapClick,
      handleReset,
      clearSelectedLocation,
    },
  };
}
