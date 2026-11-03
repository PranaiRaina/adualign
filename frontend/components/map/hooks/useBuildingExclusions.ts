import type * as React from 'react';
import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import type { MapMouseEvent } from 'mapbox-gl';
import type { MapRef } from 'react-map-gl/mapbox';
import type { AnalyzeResponse } from '@/types';
import { API_URL } from '../constants';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';

type AduMode = 'detached' | 'attached';

function getDisabledBuildingsKey(buildingIndices: Iterable<number>) {
  return Array.from(buildingIndices)
    .sort((a, b) => a - b)
    .join(',');
}

export function useBuildingExclusions({
  result,
  setResult,
  aduType,
  attachedReachabilityRef,
  attachedReachableSecondaryIndices,
  attachedReachableSecondaryIndexSet,
  initialDisabledBuildingIndices = [],
  mapRef,
  setHoveredBuildingIndex,
}: {
  result: AnalyzeResponse | null;
  setResult: React.Dispatch<React.SetStateAction<AnalyzeResponse | null>>;
  aduType: 'detached' | 'attached';
  attachedReachabilityRef: React.MutableRefObject<{
    boundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
    reachableSecondaryIndices: number[];
  } | null>;
  attachedReachableSecondaryIndices: number[];
  attachedReachableSecondaryIndexSet: Set<number>;
  initialDisabledBuildingIndices?: number[];
  mapRef: React.MutableRefObject<MapRef | null>;
  setHoveredBuildingIndex: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [disabledBuildings, setDisabledBuildings] = useState<Set<number>>(
    () => new Set(initialDisabledBuildingIndices),
  );
  const initialDisabledBuildingsKey = getDisabledBuildingsKey(initialDisabledBuildingIndices);
  const disabledBuildingsByModeRef = useRef<{
    detached: Set<number>;
    attached: Set<number>;
  }>({
    detached: new Set<number>(initialDisabledBuildingIndices),
    attached: new Set<number>(initialDisabledBuildingIndices),
  });
  const latestDisabledBuildingsKeyRef = useRef(initialDisabledBuildingsKey);
  const latestAduTypeRef = useRef<AduMode>(aduType);
  const latestRecomputeRequestIdRef = useRef(0);
  const disabledBuildingsKey = useMemo(
    () => getDisabledBuildingsKey(disabledBuildings),
    [disabledBuildings],
  );
  const lastRecomputedModeRef = useRef<AduMode | null>(null);

  useLayoutEffect(() => {
    latestAduTypeRef.current = aduType;
  }, [aduType]);

  const updateDisabledBuildingsForMode = useCallback(
    (nextDisabledBuildings: Set<number>, nextAduType: AduMode) => {
      const nextDisabledBuildingsKey = getDisabledBuildingsKey(nextDisabledBuildings);
      disabledBuildingsByModeRef.current[nextAduType] = new Set(nextDisabledBuildings);
      if (nextAduType === latestAduTypeRef.current) {
        latestDisabledBuildingsKeyRef.current = nextDisabledBuildingsKey;
      }
      return nextDisabledBuildingsKey;
    },
    [],
  );

  const resetDisabledBuildings = useCallback(() => {
    disabledBuildingsByModeRef.current = { detached: new Set(), attached: new Set() };
    latestDisabledBuildingsKeyRef.current = '';
    setDisabledBuildings(new Set());
  }, []);

  const recomputeBuildableForDisabledSet = useCallback(
    async (nextDisabledBuildings: Set<number>, overrideAduType?: AduMode) => {
      if (!result) return;

      const effectiveAduType = overrideAduType ?? aduType;
      const requestDisabledBuildingsKey = getDisabledBuildingsKey(nextDisabledBuildings);
      const requestId = latestRecomputeRequestIdRef.current + 1;
      const requestResult = result;
      latestRecomputeRequestIdRef.current = requestId;
      const isRecomputeRequestCurrent = () =>
        requestId === latestRecomputeRequestIdRef.current &&
        effectiveAduType === latestAduTypeRef.current &&
        requestDisabledBuildingsKey === latestDisabledBuildingsKeyRef.current;
      const isAttached = effectiveAduType === 'attached';

      // For attached mode: primary = index 0, secondaries = everything else (non-disabled)
      // For detached mode: all active buildings (including primary) go through the standard path
      const activeBuildings = isAttached
        ? result.detected_buildings.filter((_, i) => i !== 0 && !nextDisabledBuildings.has(i))
        : result.detected_buildings.filter((_, i) => i === 0 || !nextDisabledBuildings.has(i));

      try {
        const body: Record<string, unknown> = {
          property_geojson: result.property_geojson,
          setback_ft: result.setback_ft,
          active_buildings: activeBuildings,
          adu_type: effectiveAduType,
        };

        // Attached mode requires the primary structure sent separately
        if (isAttached && result.detected_buildings?.[0]) {
          body.primary_structure_geojson = result.detected_buildings[0];
        }

        const res = await fetch(`${API_URL}/recompute-buildable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          if (!isRecomputeRequestCurrent()) return;

          setResult((prev) => {
            if (!isRecomputeRequestCurrent()) return prev;
            if (prev !== requestResult) return prev;
            return {
              ...prev,
              buildable_zone_geojson: data.buildable_zone_geojson,
              unbuildable_zone_geojson: data.unbuildable_zone_geojson,
              buildable_area_sqft: data.buildable_area_sqft,
            };
          });
        }
      } catch (err) {
        console.error('Recompute buildable failed:', err);
      }
    },
    [result, aduType, setResult],
  );

  const getDisabledBuildingsForMode = useCallback(
    (nextAduType: AduMode) => {
      const savedForMode = new Set(disabledBuildingsByModeRef.current[nextAduType]);
      if (!result?.detected_buildings || result.detected_buildings.length <= 1) {
        updateDisabledBuildingsForMode(savedForMode, nextAduType);
        return savedForMode;
      }
      if (nextAduType === 'detached') {
        updateDisabledBuildingsForMode(savedForMode, nextAduType);
        return savedForMode;
      }

      // Attached mode always force-hides any secondary structure outside the culling zone,
      // while preserving user toggles for in-zone structures.
      const allSecondaryIndices = Array.from(
        { length: result.detected_buildings.length - 1 },
        (_, idx) => idx + 1,
      );
      const reachableIndices = attachedReachabilityRef.current
        ? attachedReachabilityRef.current.reachableSecondaryIndices
        : allSecondaryIndices;
      const reachableSet = new Set(reachableIndices);
      for (const i of allSecondaryIndices) {
        if (!reachableSet.has(i)) savedForMode.add(i);
      }
      updateDisabledBuildingsForMode(savedForMode, nextAduType);
      return savedForMode;
    },
    [result?.detected_buildings, attachedReachabilityRef, updateDisabledBuildingsForMode],
  );

  // Break circular dependencies by storing the latest callback refs
  const disabledSystemCallbacksRef = useRef({
    recomputeBuildableForDisabledSet,
    getDisabledBuildingsForMode,
  });

  useEffect(() => {
    disabledSystemCallbacksRef.current = {
      recomputeBuildableForDisabledSet,
      getDisabledBuildingsForMode,
    };
  }, [recomputeBuildableForDisabledSet, getDisabledBuildingsForMode]);

  // Keep the currently active disabled set synced to the selected ADU mode.
  // This preserves detached/attached selections independently for the same analysis.
  useEffect(() => {
    if (!result) return;
    const { getDisabledBuildingsForMode, recomputeBuildableForDisabledSet } =
      disabledSystemCallbacksRef.current;

    const syncedDisabled = getDisabledBuildingsForMode(aduType);
    const syncedKey = getDisabledBuildingsKey(syncedDisabled);
    const modeChanged = lastRecomputedModeRef.current !== aduType;
    updateDisabledBuildingsForMode(syncedDisabled, aduType);
    if (syncedKey !== disabledBuildingsKey) {
      setDisabledBuildings(syncedDisabled);
    }
    if (!modeChanged && syncedKey === disabledBuildingsKey) return;
    lastRecomputedModeRef.current = aduType;
    void recomputeBuildableForDisabledSet(syncedDisabled, aduType);
  }, [
    aduType,
    result,
    result?.detected_buildings,
    attachedReachableSecondaryIndices,
    disabledBuildingsKey,
    updateDisabledBuildingsForMode,
  ]);

  // Toggle a secondary building on/off + recompute buildable zone
  const toggleBuilding = useCallback(
    async (buildingIndex: number) => {
      if (!result) return;
      // Primary structure (index 0) cannot be toggled
      if (buildingIndex === 0) return;
      if (aduType === 'attached' && !attachedReachableSecondaryIndexSet.has(buildingIndex)) return;

      const next = new Set(disabledBuildings);
      if (next.has(buildingIndex)) {
        next.delete(buildingIndex);
      } else {
        next.add(buildingIndex);
      }
      setDisabledBuildings(next);
      updateDisabledBuildingsForMode(next, aduType);
      await recomputeBuildableForDisabledSet(next);
    },
    [
      result,
      disabledBuildings,
      aduType,
      attachedReachableSecondaryIndexSet,
      recomputeBuildableForDisabledSet,
      updateDisabledBuildingsForMode,
    ],
  );

  const restoreDisabledBuildings = useCallback(
    async (buildingIndices: number[]) => {
      if (!result?.detected_buildings?.length) {
        return;
      }

      const nextDisabledBuildings = new Set(
        buildingIndices.filter(
          (index) =>
            index > 0 && Number.isInteger(index) && index < result.detected_buildings.length,
        ),
      );

      setDisabledBuildings(nextDisabledBuildings);
      updateDisabledBuildingsForMode(nextDisabledBuildings, aduType);
      lastRecomputedModeRef.current = aduType;
      await recomputeBuildableForDisabledSet(nextDisabledBuildings, aduType);
    },
    [
      aduType,
      recomputeBuildableForDisabledSet,
      result?.detected_buildings,
      updateDisabledBuildingsForMode,
    ],
  );

  const onBuildingClick = useCallback(
    (e: MapMouseEvent) => {
      if (e.features && e.features.length > 0) {
        const idx = e.features[0].properties?.index;
        if (typeof idx === 'number') {
          if (aduType === 'attached' && idx > 0 && !attachedReachableSecondaryIndexSet.has(idx))
            return;
          e.originalEvent?.stopPropagation();
          toggleBuilding(idx);
        }
      }
    },
    [toggleBuilding, aduType, attachedReachableSecondaryIndexSet],
  );

  const onBuildingEnter = useCallback(
    (e: MapMouseEvent) => {
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = 'pointer';
      }
      const idx = e.features?.[0]?.properties?.index;
      if (typeof idx === 'number' && idx > 0) {
        if (aduType === 'attached' && !attachedReachableSecondaryIndexSet.has(idx)) return;
        setHoveredBuildingIndex(idx);
      }
    },
    [aduType, attachedReachableSecondaryIndexSet, mapRef, setHoveredBuildingIndex],
  );

  const onBuildingLeave = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = '';
    }
    setHoveredBuildingIndex(-1);
  }, [mapRef, setHoveredBuildingIndex]);

  return {
    disabledBuildings,
    disabledBuildingsKey,
    toggleBuilding,
    restoreDisabledBuildings,
    onBuildingClick,
    onBuildingEnter,
    onBuildingLeave,
    resetDisabledBuildings,
  };
}
