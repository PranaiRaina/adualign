import type * as React from 'react';
import { useMemo, useEffect } from 'react';
import * as turf from '@turf/turf';
import type { AnalyzeResponse } from '@/types';
import {
  ATTACHED_DRAG_CLAMP_PADDING_METERS,
  ATTACHED_MAX_REACHABLE_DISTANCE_METERS,
  MOVEMENT_BOUNDARY_BUFFER_FEET,
  METERS_PER_DEGREE_LAT,
} from '../constants';

export function useMapLayers({
  result,
  aduType,
  disabledBuildings,
  attachedReachabilityRef,
  attachedReachableSecondaryIndices,
  setAttachedReachableSecondaryIndices,
  hoveredBuildingIndex,
  setHoveredBuildingIndex,
}: {
  result: AnalyzeResponse | null;
  aduType: 'detached' | 'attached';
  disabledBuildings: Set<number>;
  attachedReachabilityRef: React.MutableRefObject<{
    boundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
    reachableSecondaryIndices: number[];
  } | null>;
  attachedReachableSecondaryIndices: number[];
  setAttachedReachableSecondaryIndices: React.Dispatch<React.SetStateAction<number[]>>;
  hoveredBuildingIndex: number;
  setHoveredBuildingIndex: React.Dispatch<React.SetStateAction<number>>;
}) {
  const propertyLayer = useMemo(() => {
    if (!result?.property_geojson) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: result.property_geojson as unknown as GeoJSON.Geometry,
    };
  }, [result?.property_geojson]);

  const unbuildableLayer = useMemo(() => {
    if (!result?.unbuildable_zone_geojson) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: result.unbuildable_zone_geojson as unknown as GeoJSON.Geometry,
    };
  }, [result?.unbuildable_zone_geojson]);

  const buildableLayer = useMemo(() => {
    if (!result?.buildable_zone_geojson) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: result.buildable_zone_geojson as unknown as GeoJSON.Geometry,
    };
  }, [result?.buildable_zone_geojson]);

  // Compute a giant invisible movement boundary (50 feet buffer) to allow the user
  // to drag the ADU freely without getting stuck, while still having some map bounds.
  const movementBoundary = useMemo((): GeoJSON.Feature<GeoJSON.Geometry> | null => {
    if (!result?.property_geojson) return null;
    try {
      return turf.buffer(
        turf.feature(result.property_geojson as any),
        MOVEMENT_BOUNDARY_BUFFER_FEET,
        { units: 'feet' },
      ) as GeoJSON.Feature<GeoJSON.Geometry>;
    } catch (e) {
      console.warn('Failed to compute movement boundary', e);
      return null;
    }
  }, [result?.property_geojson]);

  const attachedDragBounds = useMemo(() => {
    const primary = result?.detected_buildings?.[0] as GeoJSON.Geometry | undefined;
    if (!primary) return null;

    const allCoords: number[][] = [];
    if (primary.type === 'Polygon') {
      for (const ring of primary.coordinates as number[][][]) allCoords.push(...ring);
    } else if (primary.type === 'MultiPolygon') {
      for (const poly of primary.coordinates as number[][][][]) {
        for (const ring of poly) allCoords.push(...ring);
      }
    }
    if (!allCoords.length) return null;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of allCoords) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    const centerLat = (minLat + maxLat) / 2;
    const padLat = ATTACHED_DRAG_CLAMP_PADDING_METERS / METERS_PER_DEGREE_LAT;
    const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
    const safeMetersPerDegLng = Math.abs(metersPerDegLng) < 1e-6 ? 1e-6 : metersPerDegLng;
    const padLng = ATTACHED_DRAG_CLAMP_PADDING_METERS / safeMetersPerDegLng;

    return {
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
    };
  }, [result?.detected_buildings]);

  const propertySourceData = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!propertyLayer) return null;
    return {
      type: 'FeatureCollection',
      features: [propertyLayer],
    };
  }, [propertyLayer]);

  const activeUnbuildableSourceData = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!unbuildableLayer) return null;
    return {
      type: 'FeatureCollection',
      features: [unbuildableLayer as GeoJSON.Feature],
    };
  }, [unbuildableLayer]);

  // The backend returns the correct buildable zone for the current mode
  // (detached or attached), so we always use buildableLayer directly.
  const activeBuildableFeature = buildableLayer;

  const activeBuildableSourceData = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!activeBuildableFeature) return null;
    return {
      type: 'FeatureCollection',
      features: [activeBuildableFeature],
    };
  }, [activeBuildableFeature]);

  useEffect(() => {
    if (!result?.detected_buildings?.[0]) {
      attachedReachabilityRef.current = null;
      setAttachedReachableSecondaryIndices([]);
      return;
    }

    try {
      const primaryFeature = turf.feature(result.detected_buildings[0] as any);
      const cullingBoundary = turf.buffer(primaryFeature, ATTACHED_MAX_REACHABLE_DISTANCE_METERS, {
        units: 'meters',
      });
      const reachableSecondaryIndices: number[] = [];

      if (result.detected_buildings.length > 1) {
        for (let i = 1; i < result.detected_buildings.length; i++) {
          const secondaryFeature = turf.feature(result.detected_buildings[i] as any);
          if (turf.booleanIntersects(cullingBoundary as any, secondaryFeature as any)) {
            reachableSecondaryIndices.push(i);
          }
        }
      }

      attachedReachabilityRef.current = {
        boundary: cullingBoundary as GeoJSON.Feature<GeoJSON.Geometry>,
        reachableSecondaryIndices,
      };
      setAttachedReachableSecondaryIndices(reachableSecondaryIndices);
    } catch (e) {
      console.warn('Failed to compute attached-mode culling boundary', e);
      const fallbackReachableIndices =
        result.detected_buildings.length > 1
          ? Array.from({ length: result.detected_buildings.length - 1 }, (_, idx) => idx + 1)
          : [];
      attachedReachabilityRef.current = {
        boundary: null,
        reachableSecondaryIndices: fallbackReachableIndices,
      };
      setAttachedReachableSecondaryIndices(fallbackReachableIndices);
    }
  }, [result, attachedReachabilityRef, setAttachedReachableSecondaryIndices]);

  const attachedReachableSecondaryIndexSet = useMemo(
    () => new Set(attachedReachableSecondaryIndices),
    [attachedReachableSecondaryIndices],
  );

  const visibleSecondaryBuildingIndices = useMemo(() => {
    if (!result?.detected_buildings || result.detected_buildings.length <= 1) return [];
    if (aduType !== 'attached') {
      return Array.from({ length: result.detected_buildings.length - 1 }, (_, idx) => idx + 1);
    }
    return attachedReachableSecondaryIndices;
  }, [result?.detected_buildings, aduType, attachedReachableSecondaryIndices]);

  // Visual-only cleanup: clip detected building footprints to parcel bounds so
  // exclusion outlines do not extend beyond the property boundary on the map.
  const clippedBuildingGeometries = useMemo<GeoJSON.Geometry[]>(() => {
    if (!result?.detected_buildings?.length) return [];
    if (!result?.property_geojson) {
      return result.detected_buildings as unknown as GeoJSON.Geometry[];
    }

    const propertyFeature = turf.feature(result.property_geojson as any);

    return result.detected_buildings.map((building) => {
      try {
        const buildingFeature = turf.feature(building as any);

        // Fast path: already inside parcel, keep original geometry as-is.
        if (turf.booleanWithin(buildingFeature as any, propertyFeature as any)) {
          return building as unknown as GeoJSON.Geometry;
        }

        const clipped = turf.intersect(
          turf.featureCollection([buildingFeature as any, propertyFeature as any]),
        );

        return (clipped?.geometry as GeoJSON.Geometry) ?? (building as unknown as GeoJSON.Geometry);
      } catch {
        return building as unknown as GeoJSON.Geometry;
      }
    });
  }, [result?.detected_buildings, result?.property_geojson]);

  const activeBuildingExclusionsData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: clippedBuildingGeometries
        .map((geometry, index) => ({
          type: 'Feature' as const,
          properties: { index },
          geometry,
        }))
        .filter((feature) =>
          isActiveStructureIndex({
            index: feature.properties.index,
            disabledBuildings,
            aduType,
            attachedReachableSecondaryIndexSet,
          }),
        ),
    }),
    [clippedBuildingGeometries, disabledBuildings, aduType, attachedReachableSecondaryIndexSet],
  );

  const disabledBuildingExclusionsData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: clippedBuildingGeometries
        .map((geometry, index) => ({
          type: 'Feature' as const,
          properties: { index },
          geometry,
        }))
        .filter((feature) => {
          const idx = feature.properties.index;
          if (!disabledBuildings.has(idx)) return false;
          if (idx > 0 && aduType === 'attached' && !attachedReachableSecondaryIndexSet.has(idx)) {
            return false;
          }
          return true;
        }),
    }),
    [clippedBuildingGeometries, disabledBuildings, aduType, attachedReachableSecondaryIndexSet],
  );

  const hoveredBuildingData = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (hoveredBuildingIndex <= 0 || !result?.detected_buildings?.[hoveredBuildingIndex]) {
      return null;
    }
    if (aduType === 'attached' && !attachedReachableSecondaryIndexSet.has(hoveredBuildingIndex)) {
      return null;
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry:
            clippedBuildingGeometries[hoveredBuildingIndex] ??
            (result.detected_buildings[hoveredBuildingIndex] as unknown as GeoJSON.Geometry),
        },
      ],
    };
  }, [
    hoveredBuildingIndex,
    clippedBuildingGeometries,
    result?.detected_buildings,
    aduType,
    attachedReachableSecondaryIndexSet,
  ]);

  useEffect(() => {
    if (
      aduType === 'attached' &&
      hoveredBuildingIndex > 0 &&
      !attachedReachableSecondaryIndexSet.has(hoveredBuildingIndex)
    ) {
      setHoveredBuildingIndex(-1);
    }
  }, [aduType, hoveredBuildingIndex, attachedReachableSecondaryIndexSet, setHoveredBuildingIndex]);

  return {
    propertyLayer,
    propertySourceData,
    activeUnbuildableSourceData,
    activeBuildableFeature,
    activeBuildableSourceData,
    movementBoundary,
    attachedDragBounds,
    attachedReachabilityRef,
    attachedReachableSecondaryIndices,
    attachedReachableSecondaryIndexSet,
    visibleSecondaryBuildingIndices,
    clippedBuildingGeometries,
    activeBuildingExclusionsData,
    disabledBuildingExclusionsData,
    hoveredBuildingData,
  };
}

function isActiveStructureIndex({
  index,
  disabledBuildings,
  aduType,
  attachedReachableSecondaryIndexSet,
}: {
  index: number;
  disabledBuildings: Set<number>;
  aduType: 'detached' | 'attached';
  attachedReachableSecondaryIndexSet: Set<number>;
}) {
  if (disabledBuildings.has(index)) return false;
  if (index === 0 || aduType !== 'attached') return true;
  return attachedReachableSecondaryIndexSet.has(index);
}
