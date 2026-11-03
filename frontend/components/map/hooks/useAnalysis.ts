import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';
import type { Map as MapboxMap } from 'mapbox-gl';
import * as turf from '@turf/turf';
import polylabel from 'polylabel';
import type { AnalyzeRequest, AnalyzeResponse, GeoJSONGeometry } from '@/types';
import type { MapSnapshot } from '@/lib/planningDraft';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import type { BackendSnapshotRestore } from './useBackendSnapshotRestore';
import type {
  ShapeType,
  LegDimensions,
  AduAction,
  MapLocation,
  RectangleShapeState,
  ShapeStateCache,
} from '../types';
import {
  API_URL,
  FALLBACK_SPAWN_MIN_SIZE_SQFT,
  FALLBACK_SPAWN_RING_STEP_METERS,
  FALLBACK_SPAWN_MAX_RADIUS_METERS,
  DEFAULT_SEARCH_ZOOM,
  CAMERA_FLY_TO_DURATION_MS,
  CAMERA_SLOW_FLY_TO_DURATION_MS,
  MAP_ANALYSIS_READY_TIMEOUT_MS,
  MAP_ANALYSIS_READY_POLL_INTERVAL_MS,
  MAP_ANALYSIS_BUILDING_RETRY_COUNT,
  METERS_PER_DEGREE_LAT,
  MIN_COS_LAT,
  BBOX_PADDING_DEG,
  POLYLABEL_PRECISION_FINE,
  AUTO_CORRECT_ANGLE_STEP_DEG,
} from '../constants';
import { findOptimalAduPlacement } from '../utils/findOptimalAduPlacement';
import { isPolygonWithinZone } from '../utils/polygonContainment';
import { generateAduPolygon, getLargestPolyRings } from '../utils/geometry';

const MAP_ANALYSIS_LOADING_ERROR = 'Map data is still loading. Please wait a moment and try again.';
const AUTO_ANALYSIS_LOCATION_PRECISION = 6;

function shouldResetAfterLookupFailure(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes('no parcel') ||
    normalized.includes('parcel not found') ||
    normalized.includes('property not found') ||
    normalized.includes('not found at coordinates') ||
    normalized.includes('unable to locate') ||
    normalized.includes('could not locate') ||
    (normalized.includes('coordinates') && normalized.includes('not found'))
  );
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

function getAutoAnalysisLocationKey(location: MapLocation | null) {
  if (!location) {
    return null;
  }

  return `${location.lat.toFixed(AUTO_ANALYSIS_LOCATION_PRECISION)},${location.lng.toFixed(
    AUTO_ANALYSIS_LOCATION_PRECISION,
  )}`;
}

function buildAnalysisSessionKey(args: {
  selectedLocation: MapLocation | null;
  projectId?: string;
  mapSearchId?: string;
}) {
  if (!args.selectedLocation) {
    return 'no-location';
  }

  return [
    args.projectId ?? '',
    args.mapSearchId ?? '',
    args.selectedLocation.lat.toFixed(AUTO_ANALYSIS_LOCATION_PRECISION),
    args.selectedLocation.lng.toFixed(AUTO_ANALYSIS_LOCATION_PRECISION),
    args.selectedLocation.name,
  ].join('|');
}

export function useAnalysis({
  selectedLocation,
  selectedLocationOrigin,
  projectId,
  mapSearchId,
  onMapSearchCharged,
  initialLocation,
  shouldAutoAnalyzeInitialLocation,
  autoAnalyzePending,
  setAutoAnalyzePending,
  isLoggedIn,
  isAuthLoading,
  onAuthRequired,
  onLookupFailureCleanup,
  mapRef,
  result,
  isLoading,
  error,
  aduAspectRatio,
  aduRotation,
  aduShapeType,
  currentLegDimensions,
  restore,
  setResult,
  setIsLoading,
  setError,
  setYardZones,
  setEdgeSelectMode,
  resetDisabledBuildings,
  dispatchCenter,
  dispatch,
  setAduShapeType,
  shapeStatesRef,
  initialRectangleStateRef,
}: {
  selectedLocation: MapLocation | null;
  selectedLocationOrigin: 'initial' | 'runtime';
  projectId?: string;
  mapSearchId?: string;
  onMapSearchCharged?: () => void;
  initialLocation?: MapLocation;
  shouldAutoAnalyzeInitialLocation: boolean;
  autoAnalyzePending: boolean;
  setAutoAnalyzePending: React.Dispatch<React.SetStateAction<boolean>>;
  isLoggedIn: boolean;
  isAuthLoading: boolean;
  onAuthRequired?: () => void;
  onLookupFailureCleanup?: () => void;
  mapRef: React.MutableRefObject<MapRef | null>;
  result: AnalyzeResponse | null;
  isLoading: boolean;
  error: string | null;
  aduAspectRatio: number;
  aduRotation: number;
  aduShapeType: ShapeType;
  currentLegDimensions: LegDimensions[keyof LegDimensions] | undefined;
  restore: BackendSnapshotRestore;
  setResult: React.Dispatch<React.SetStateAction<AnalyzeResponse | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setYardZones: React.Dispatch<
    React.SetStateAction<{
      front_yard_geojson: GeoJSONGeometry | null;
      rear_yard_geojson: GeoJSONGeometry | null;
      side_yard_geojson: GeoJSONGeometry | null;
    } | null>
  >;
  setEdgeSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  resetDisabledBuildings: () => void;
  dispatchCenter: (center: { lng: number; lat: number } | null) => void;
  dispatch: React.Dispatch<AduAction>;
  setAduShapeType: React.Dispatch<React.SetStateAction<ShapeType>>;
  shapeStatesRef: React.MutableRefObject<ShapeStateCache>;
  initialRectangleStateRef: React.MutableRefObject<RectangleShapeState | null>;
}) {
  const pendingRestoreSnapshot = restore.state.pendingSnapshot;
  const markSnapshotHandled = restore.actions.markSnapshotHandled;
  const activeAutoAnalysisLocationKeyRef = useRef<string | null>(null);
  const completedAutoAnalysisLocationKeyRef = useRef<string | null>(null);
  const analysisSessionKeyRef = useRef(
    buildAnalysisSessionKey({ selectedLocation, projectId, mapSearchId }),
  );
  const latestAnalysisRunIdRef = useRef(0);
  const [isAutoAnalyzeStarting, setIsAutoAnalyzeStarting] = useState(false);
  const autoAnalysisLocationKey = getAutoAnalysisLocationKey(selectedLocation);

  useEffect(() => {
    analysisSessionKeyRef.current = buildAnalysisSessionKey({
      selectedLocation,
      projectId,
      mapSearchId,
    });
  }, [mapSearchId, projectId, selectedLocation]);

  /**
   * Waits for the Mapbox instance to exist before analysis begins.
   */
  const waitForMapInstance = useCallback(async (): Promise<MapboxMap> => {
    const deadline = Date.now() + MAP_ANALYSIS_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const map = mapRef.current?.getMap() ?? null;
      if (map) {
        return map;
      }
      await sleep(MAP_ANALYSIS_READY_POLL_INTERVAL_MS);
    }

    throw new Error(MAP_ANALYSIS_LOADING_ERROR);
  }, [mapRef]);

  const isMapReadyForBuildingLayer = useCallback((map: MapboxMap): boolean => {
    return map.isStyleLoaded() && typeof map.getLayer('building') !== 'undefined';
  }, []);

  const waitForMapQueryPrerequisites = useCallback(
    async (map: MapboxMap): Promise<void> => {
      const deadline = Date.now() + MAP_ANALYSIS_READY_TIMEOUT_MS;

      while (Date.now() < deadline) {
        if (isMapReadyForBuildingLayer(map)) {
          return;
        }
        await sleep(MAP_ANALYSIS_READY_POLL_INTERVAL_MS);
      }

      throw new Error(MAP_ANALYSIS_LOADING_ERROR);
    },
    [isMapReadyForBuildingLayer],
  );

  const isMapReadyForBuildingQueries = useCallback(
    (map: MapboxMap): boolean => {
      return isMapReadyForBuildingLayer(map) && map.areTilesLoaded();
    },
    [isMapReadyForBuildingLayer],
  );

  const waitForMapAnalysisReadiness = useCallback(
    async (map: MapboxMap): Promise<void> => {
      const deadline = Date.now() + MAP_ANALYSIS_READY_TIMEOUT_MS;

      while (Date.now() < deadline) {
        if (isMapReadyForBuildingQueries(map)) {
          return;
        }
        await sleep(MAP_ANALYSIS_READY_POLL_INTERVAL_MS);
      }

      throw new Error(MAP_ANALYSIS_LOADING_ERROR);
    },
    [isMapReadyForBuildingQueries],
  );

  const flyToLocationAndWaitForIdle = useCallback(
    async (map: MapboxMap, lng: number, lat: number): Promise<MapboxMap> => {
      map.flyTo({
        center: [lng, lat],
        zoom: DEFAULT_SEARCH_ZOOM,
        duration: CAMERA_FLY_TO_DURATION_MS,
      });

      await new Promise<void>((resolve) => {
        let isResolved = false;
        const finish = () => {
          if (isResolved) return;
          isResolved = true;
          map.off('idle', finish);
          resolve();
        };

        map.once('idle', finish);
        window.setTimeout(finish, CAMERA_SLOW_FLY_TO_DURATION_MS);
      });

      await waitForMapAnalysisReadiness(map);
      return map;
    },
    [waitForMapAnalysisReadiness],
  );

  /**
   * Queries the Mapbox GL canvas for rendered building features within a
   * tight bounding box (~200 ft) around the search point. This prevents
   * gated-community parcels from capturing dozens of neighbor houses.
   */
  const queryRenderedBuildingFootprints = useCallback(
    (map: MapboxMap): GeoJSONGeometry[] => {
      if (!selectedLocation) {
        // Fallback: full viewport if no location (shouldn't happen in practice)
        const canvas = map.getCanvas();
        return _queryBuildingsInBounds(map, [
          [0, 0],
          [canvas.width, canvas.height],
        ]);
      }

      // ~200 ft ≈ ~61 m ≈ ~0.00055° lat, adjusted for longitude
      const RADIUS_DEG_LAT = 0.00055;
      const cosLat = Math.max(0.000001, Math.cos((selectedLocation.lat * Math.PI) / 180));
      const RADIUS_DEG_LNG = RADIUS_DEG_LAT / cosLat;

      const sw = map.project([
        selectedLocation.lng - RADIUS_DEG_LNG,
        selectedLocation.lat - RADIUS_DEG_LAT,
      ]);
      const ne = map.project([
        selectedLocation.lng + RADIUS_DEG_LNG,
        selectedLocation.lat + RADIUS_DEG_LAT,
      ]);

      const bbox: [[number, number], [number, number]] = [
        [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
        [Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)],
      ];

      return _queryBuildingsInBounds(map, bbox);
    },
    [selectedLocation],
  );

  const queryBuildingFootprintsWithRetry = useCallback(
    async (map: MapboxMap): Promise<GeoJSONGeometry[]> => {
      let buildingFootprints: GeoJSONGeometry[] = [];

      for (let attempt = 0; attempt < MAP_ANALYSIS_BUILDING_RETRY_COUNT; attempt += 1) {
        buildingFootprints = queryRenderedBuildingFootprints(map);
        if (buildingFootprints.length > 0) {
          return buildingFootprints;
        }

        if (attempt < MAP_ANALYSIS_BUILDING_RETRY_COUNT - 1) {
          await sleep(MAP_ANALYSIS_READY_POLL_INTERVAL_MS);
          await waitForMapAnalysisReadiness(map);
        }
      }

      return buildingFootprints;
    },
    [queryRenderedBuildingFootprints, waitForMapAnalysisReadiness],
  );

  const canRestorePlacementFromSnapshot = useCallback(
    (data: AnalyzeResponse, snapshot: MapSnapshot) => {
      if (!snapshot.adu.center) {
        return false;
      }

      const targetZone = data.property_geojson;
      if (!targetZone) {
        return false;
      }

      const restoredLegDimensions =
        snapshot.adu.shapeType === 'rectangle'
          ? undefined
          : snapshot.adu.legDimensions[snapshot.adu.shapeType];
      const restoredPolygon = generateAduPolygon(
        snapshot.adu.center,
        snapshot.adu.size,
        snapshot.adu.aspectRatio,
        snapshot.adu.rotation,
        snapshot.adu.shapeType,
        restoredLegDimensions,
      );
      if (!restoredPolygon) {
        return false;
      }

      return isPolygonWithinZone(
        turf.feature(targetZone as unknown as GeoJSON.Geometry) as any,
        restoredPolygon as any,
      );
    },
    [],
  );

  const applyRestoredAduPlacement = useCallback(
    (snapshot: MapSnapshot) => {
      const snapshotCenter = snapshot.adu.center;
      if (!snapshotCenter) {
        return false;
      }

      shapeStatesRef.current = {
        rectangle: null,
        'l-shape': null,
        't-shape': null,
        'u-shape': null,
      };

      const restoredShapeState = {
        center: snapshotCenter,
        size: snapshot.adu.size,
        aspectRatio: snapshot.adu.aspectRatio,
        rotation: snapshot.adu.rotation,
        ...(snapshot.adu.shapeType === 'rectangle'
          ? {}
          : { legDimensions: snapshot.adu.legDimensions[snapshot.adu.shapeType] }),
      };

      if (snapshot.adu.shapeType === 'rectangle') {
        initialRectangleStateRef.current = restoredShapeState;
      } else {
        initialRectangleStateRef.current = null;
      }
      shapeStatesRef.current[snapshot.adu.shapeType] = restoredShapeState;

      dispatch({
        type: 'BATCH',
        actions: [
          { type: 'SET_TYPE', aduType: snapshot.adu.type },
          { type: 'SET_SIZE', size: snapshot.adu.size },
          { type: 'SET_ASPECT_RATIO', aspectRatio: snapshot.adu.aspectRatio },
          { type: 'SET_ROTATION', rotation: snapshot.adu.rotation },
          {
            type: 'SET_LEG_DIMENSIONS',
            shape: 'l-shape',
            dims: snapshot.adu.legDimensions['l-shape'],
          },
          {
            type: 'SET_LEG_DIMENSIONS',
            shape: 't-shape',
            dims: snapshot.adu.legDimensions['t-shape'],
          },
          {
            type: 'SET_LEG_DIMENSIONS',
            shape: 'u-shape',
            dims: snapshot.adu.legDimensions['u-shape'],
          },
        ],
      });
      dispatchCenter(snapshotCenter);
      setAduShapeType(snapshot.adu.shapeType);
      return true;
    },
    [dispatch, dispatchCenter, initialRectangleStateRef, setAduShapeType, shapeStatesRef],
  );

  /** Shared helper: query + deduplicate building features within a pixel bbox. */
  const _queryBuildingsInBounds = (
    map: MapboxMap,
    bbox: [[number, number], [number, number]],
  ): GeoJSONGeometry[] => {
    const features = map.queryRenderedFeatures(bbox, { layers: ['building'] });

    const buildingFootprints: GeoJSONGeometry[] = [];
    const seen = new Set<string | number>();

    for (const f of features) {
      const fid =
        f.id ??
        `${f.geometry.type}-${JSON.stringify((f.geometry as GeoJSON.Polygon).coordinates?.[0]?.[0])}`;
      if (seen.has(fid)) continue;
      seen.add(fid);

      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        buildingFootprints.push({
          type: f.geometry.type as 'Polygon' | 'MultiPolygon',
          coordinates: (f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates as
            | number[][][]
            | number[][][][],
        });
      }
    }

    return buildingFootprints;
  };

  const fitMapToPropertyBounds = useCallback(
    (data: AnalyzeResponse) => {
      if (!data.property_geojson) return;

      const coords =
        data.property_geojson.type === 'Polygon'
          ? (data.property_geojson.coordinates as number[][][])[0]
          : (data.property_geojson.coordinates as number[][][][])[0][0];

      if (!coords || coords.length === 0) return;

      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);

      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      mapRef.current?.fitBounds(
        [
          [minLng - BBOX_PADDING_DEG, minLat - BBOX_PADDING_DEG],
          [maxLng + BBOX_PADDING_DEG, maxLat + BBOX_PADDING_DEG],
        ],
        { duration: CAMERA_FLY_TO_DURATION_MS },
      );
    },
    [mapRef],
  );

  /**
   * Given the API response, computes the best initial ADU center / size /
   * aspect-ratio / rotation and applies the result via dispatch + dispatchCenter.
   */
  const applyInitialAduPlacement = useCallback(
    (data: AnalyzeResponse) => {
      if (!data.property_geojson) return;

      const coords =
        data.property_geojson.type === 'Polygon'
          ? (data.property_geojson.coordinates as number[][][])[0]
          : (data.property_geojson.coordinates as number[][][][])[0][0];

      if (!coords || coords.length === 0) return;

      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);

      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      const best = findOptimalAduPlacement(data, generateAduPolygon);

      // Clear memory for all shapes so they start fresh
      shapeStatesRef.current = {
        rectangle: null,
        'l-shape': null,
        't-shape': null,
        'u-shape': null,
      };

      if (best) {
        initialRectangleStateRef.current = {
          center: { lng: best.lng, lat: best.lat },
          size: best.size,
          aspectRatio: best.aspectRatio,
          rotation: best.rotation,
        };
        shapeStatesRef.current.rectangle = { ...initialRectangleStateRef.current };

        dispatchCenter({ lng: best.lng, lat: best.lat });
        dispatch({ type: 'SET_SIZE', size: best.size });
        dispatch({ type: 'SET_ASPECT_RATIO', aspectRatio: best.aspectRatio });
        dispatch({ type: 'SET_ROTATION', rotation: best.rotation });
        setAduShapeType('rectangle');
        return;
      }

      // Fallback: polylabel center, minimum size
      // Smart ADU Spawning Logic: Use polylabel for deep interior points
      let targetPoint: number[] | null = null;

      // 1. Try to spawn deep inside the safe buildable zone
      if (data.buildable_zone_geojson) {
        try {
          const allRings = getLargestPolyRings(data.buildable_zone_geojson as any);
          if (allRings) {
            targetPoint = polylabel(allRings, POLYLABEL_PRECISION_FINE);
          }
        } catch (e) {
          console.warn('Could not find pole of inaccessibility in buildable zone', e);
        }
      }

      // 2. Fallback: Try to spawn on the primary structure
      if (!targetPoint && data.detected_buildings && data.detected_buildings.length > 0) {
        try {
          const allRings = getLargestPolyRings(data.detected_buildings[0] as any);
          if (allRings) {
            targetPoint = polylabel(allRings, POLYLABEL_PRECISION_FINE);
          }
        } catch (e) {
          console.warn('Could not find pole of inaccessibility on primary structure', e);
        }
      }

      // 3. Last Resort: Spawn somewhere deep inside the property boundary
      if (!targetPoint && data.property_geojson) {
        try {
          const allRings = getLargestPolyRings(data.property_geojson as any);
          if (allRings) {
            targetPoint = polylabel(allRings, POLYLABEL_PRECISION_FINE);
          }
        } catch (e) {
          console.warn('Could not find pole of inaccessibility in property boundary', e);
        }
      }

      // Set ADU center, defaulting to the old bounding box math if all turf methods fail
      let fallbackCenter: { lng: number; lat: number } = {
        lng: (minLng + maxLng) / 2,
        lat: (minLat + maxLat) / 2,
      };
      if (targetPoint) {
        fallbackCenter = { lng: targetPoint[0], lat: targetPoint[1] };
      }

      // Validate fallback spawn. If the seed is invalid, search nearby before committing.
      let resolvedCenter = fallbackCenter;
      const buildableFeature = data.buildable_zone_geojson
        ? turf.feature(data.buildable_zone_geojson as unknown as GeoJSON.Geometry)
        : null;
      const isFallbackValid = (() => {
        if (!buildableFeature) return true;
        const poly = generateAduPolygon(
          fallbackCenter,
          FALLBACK_SPAWN_MIN_SIZE_SQFT,
          aduAspectRatio,
          aduRotation,
          aduShapeType,
          currentLegDimensions,
        );
        return !!(poly && isPolygonWithinZone(buildableFeature as any, poly as any));
      })();

      if (!isFallbackValid && buildableFeature) {
        const localLatRad = (fallbackCenter.lat * Math.PI) / 180;
        const degPerMeterLat = 1 / METERS_PER_DEGREE_LAT;
        const degPerMeterLng =
          1 / (METERS_PER_DEGREE_LAT * Math.max(MIN_COS_LAT, Math.cos(localLatRad)));
        let found: { lng: number; lat: number } | null = null;

        for (
          let radius = FALLBACK_SPAWN_RING_STEP_METERS;
          radius <= FALLBACK_SPAWN_MAX_RADIUS_METERS && !found;
          radius += FALLBACK_SPAWN_RING_STEP_METERS
        ) {
          for (let angle = 0; angle < 360; angle += AUTO_CORRECT_ANGLE_STEP_DEG) {
            const rad = (angle * Math.PI) / 180;
            const candidate = {
              lng: fallbackCenter.lng + radius * Math.cos(rad) * degPerMeterLng,
              lat: fallbackCenter.lat + radius * Math.sin(rad) * degPerMeterLat,
            };
            const poly = generateAduPolygon(
              candidate,
              FALLBACK_SPAWN_MIN_SIZE_SQFT,
              aduAspectRatio,
              aduRotation,
              aduShapeType,
              currentLegDimensions,
            );
            if (poly && isPolygonWithinZone(buildableFeature as any, poly as any)) {
              found = candidate;
              break;
            }
          }
        }
        if (found) resolvedCenter = found;
      }

      dispatchCenter(resolvedCenter);
      // Start with the smallest legal size to maximize chance of fitting
      dispatch({ type: 'SET_SIZE', size: FALLBACK_SPAWN_MIN_SIZE_SQFT });
    },
    [
      aduAspectRatio,
      aduRotation,
      aduShapeType,
      currentLegDimensions,
      dispatchCenter,
      dispatch,
      shapeStatesRef,
      initialRectangleStateRef,
      setAduShapeType,
    ],
  );

  /** Trigger the full analysis */
  const handleAnalyze = useCallback(
    async (mapSearchIdOverride?: string) => {
      if (!selectedLocation) return;
      const requestedMapSearchId = mapSearchIdOverride ?? mapSearchId;
      const projectIdForRequest =
        requestedMapSearchId && requestedMapSearchId !== mapSearchId ? undefined : projectId;
      const runId = latestAnalysisRunIdRef.current + 1;
      latestAnalysisRunIdRef.current = runId;
      const requestSessionKey = buildAnalysisSessionKey({
        selectedLocation,
        projectId,
        mapSearchId: requestedMapSearchId,
      });
      const isCurrentRun = () =>
        latestAnalysisRunIdRef.current === runId &&
        analysisSessionKeyRef.current === requestSessionKey;

      // Guests can browse and pan the map freely, but running an analysis is gated
      // behind auth. Intercept here — the single chokepoint for every analysis path
      // (address search, map click, URL resume) — so no /analyze request is ever
      // issued for a signed-out user. Surface the sign-in prompt instead. The
      // backend independently enforces auth on /analyze, so this is purely UX.
      if (!isLoggedIn) {
        setAutoAnalyzePending(false);
        // If the camera is flying to the searched location, let it settle first so the
        // user gets to see their lot before the sign-in prompt appears over it. On paths
        // with no camera move (e.g. clicking the Analyze button) this resolves immediately.
        const map = mapRef.current?.getMap() ?? null;
        if (map && (map.isMoving() || map.isEasing())) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              map.off('moveend', finish);
              resolve();
            };
            map.once('moveend', finish);
            window.setTimeout(finish, CAMERA_SLOW_FLY_TO_DURATION_MS);
          });
        }
        onAuthRequired?.();
        return;
      }

      const restoreSnapshot = pendingRestoreSnapshot;
      const shouldRestoreSnapshot = !!restoreSnapshot;

      if (!shouldRestoreSnapshot) {
        dispatch({ type: 'SET_TYPE', aduType: 'detached' });
      }
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        // Step 1: Wait until the building layer exists, then fly to the parcel
        const map = await waitForMapInstance();
        await waitForMapQueryPrerequisites(map);
        const readyMap = await flyToLocationAndWaitForIdle(
          map,
          selectedLocation.lng,
          selectedLocation.lat,
        );

        // Step 2: Extract building footprints from the rendered vector tiles
        const buildingFootprints = await queryBuildingFootprintsWithRetry(readyMap);

        // Step 3: Call the backend analysis API
        const payload: AnalyzeRequest = {
          location: 'irvine_ca',
          lat: selectedLocation.lat,
          lng: selectedLocation.lng,
          building_footprints: buildingFootprints,
          project_id: projectIdForRequest,
          map_search_id: requestedMapSearchId,
        };

        const res = await fetch(`${API_URL}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          const errorDetail = detail?.detail;
          const message =
            typeof errorDetail === 'string'
              ? errorDetail
              : (errorDetail?.message ?? `Server error (${res.status})`);
          throw new Error(message);
        }

        const data: AnalyzeResponse = await res.json();
        if (data.map_search_usage?.charged) {
          onMapSearchCharged?.();
        }

        if (!isCurrentRun()) {
          return;
        }

        // Step 4: Apply the result and compute initial ADU placement
        if (!shouldRestoreSnapshot) {
          resetDisabledBuildings();
        }
        setResult(data);
        setYardZones(null);
        fitMapToPropertyBounds(data);
        if (
          shouldRestoreSnapshot &&
          restoreSnapshot &&
          canRestorePlacementFromSnapshot(data, restoreSnapshot) &&
          applyRestoredAduPlacement(restoreSnapshot)
        ) {
          setEdgeSelectMode(false);
          markSnapshotHandled();
          return;
        }

        if (shouldRestoreSnapshot && restoreSnapshot) {
          setEdgeSelectMode(false);
          markSnapshotHandled();
          applyInitialAduPlacement(data);
          return;
        }

        setEdgeSelectMode(true);
        markSnapshotHandled();
        applyInitialAduPlacement(data);
      } catch (err) {
        if (!isCurrentRun()) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Network error';
        if (shouldResetAfterLookupFailure(message)) {
          onLookupFailureCleanup?.();
        }
        setError(message);
      } finally {
        if (isCurrentRun()) {
          setIsLoading(false);
        }
      }
    },
    [
      analysisSessionKeyRef,
      selectedLocation,
      isLoggedIn,
      onAuthRequired,
      onLookupFailureCleanup,
      setAutoAnalyzePending,
      mapRef,
      projectId,
      mapSearchId,
      onMapSearchCharged,
      waitForMapInstance,
      waitForMapQueryPrerequisites,
      flyToLocationAndWaitForIdle,
      queryBuildingFootprintsWithRetry,
      pendingRestoreSnapshot,
      canRestorePlacementFromSnapshot,
      applyRestoredAduPlacement,
      markSnapshotHandled,
      fitMapToPropertyBounds,
      applyInitialAduPlacement,
      resetDisabledBuildings,
      dispatch,
      setIsLoading,
      setError,
      setResult,
      setYardZones,
      setEdgeSelectMode,
    ],
  );

  // Auto-trigger analysis once on mount if the map was opened with a URL-provided
  // initialLocation (e.g. resume-from-chat). The ref ensures this fires at most
  // once per mount, so clearing result after a manual map-click never re-triggers it.
  const hasAutoAnalyzedInitialRef = useRef(false);
  useEffect(() => {
    if (completedAutoAnalysisLocationKeyRef.current !== autoAnalysisLocationKey) {
      completedAutoAnalysisLocationKeyRef.current = null;
    }
    if (activeAutoAnalysisLocationKeyRef.current !== autoAnalysisLocationKey) {
      activeAutoAnalysisLocationKeyRef.current = null;
    }
  }, [autoAnalysisLocationKey]);

  const runAutoAnalyzeOnce = useCallback(() => {
    if (!autoAnalysisLocationKey) return;
    if (activeAutoAnalysisLocationKeyRef.current === autoAnalysisLocationKey) return;
    if (completedAutoAnalysisLocationKeyRef.current === autoAnalysisLocationKey) return;

    activeAutoAnalysisLocationKeyRef.current = autoAnalysisLocationKey;
    setIsAutoAnalyzeStarting(true);
    void handleAnalyze().finally(() => {
      setIsAutoAnalyzeStarting(false);
      if (activeAutoAnalysisLocationKeyRef.current !== autoAnalysisLocationKey) return;
      activeAutoAnalysisLocationKeyRef.current = null;
      completedAutoAnalysisLocationKeyRef.current = autoAnalysisLocationKey;
    });
  }, [autoAnalysisLocationKey, handleAnalyze]);

  useEffect(() => {
    if (
      !initialLocation ||
      selectedLocationOrigin !== 'initial' ||
      !shouldAutoAnalyzeInitialLocation ||
      hasAutoAnalyzedInitialRef.current ||
      isLoading ||
      // Wait until auth resolves before marking this as handled. Otherwise a logged-in
      // user resuming via URL would be evaluated as a guest on the first render pass.
      isAuthLoading
    ) {
      return;
    }

    hasAutoAnalyzedInitialRef.current = true;
    runAutoAnalyzeOnce();
  }, [
    initialLocation,
    isLoading,
    isAuthLoading,
    runAutoAnalyzeOnce,
    selectedLocationOrigin,
    shouldAutoAnalyzeInitialLocation,
  ]);

  // Auto-trigger analysis when an address is searched
  useEffect(() => {
    // Defer until auth resolves so we don't consume the pending flag (and prompt for
    // sign-in) before we actually know whether the user is logged in.
    if (autoAnalyzePending && selectedLocation && !isLoading && !error && !isAuthLoading) {
      setAutoAnalyzePending(false);
      runAutoAnalyzeOnce();
    }
  }, [
    autoAnalyzePending,
    selectedLocation,
    isLoading,
    error,
    isAuthLoading,
    runAutoAnalyzeOnce,
    setAutoAnalyzePending,
  ]);

  const isInitialAutoAnalysisPending = Boolean(
    initialLocation &&
    selectedLocationOrigin === 'initial' &&
    shouldAutoAnalyzeInitialLocation &&
    !hasAutoAnalyzedInitialRef.current &&
    !isLoading &&
    !result &&
    !error,
  );

  return {
    handleAnalyze,
    isAutoAnalysisQueued:
      autoAnalyzePending || isInitialAutoAnalysisPending || isAutoAnalyzeStarting,
  };
}
