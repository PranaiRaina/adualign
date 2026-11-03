import type * as React from 'react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import * as turf from '@turf/turf';
import polylabel from 'polylabel';
import {
  API_URL,
  YARD_LABEL_FADE_DELAY_MS,
  INTERNAL_YARD_LINE_THRESHOLD_METERS,
  POLYLABEL_PRECISION_ULTRA_FINE,
  RESTORED_FRONT_EDGE_MAX_DISTANCE_METERS,
} from '../constants';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import type { AnalyzeResponse, GeoJSONGeometry } from '@/types';

type YardZonesState = {
  front_yard_geojson: GeoJSONGeometry | null;
  rear_yard_geojson: GeoJSONGeometry | null;
  side_yard_geojson: GeoJSONGeometry | null;
} | null;

export function useYardZones({
  result,
  edgeSelectMode,
  setEdgeSelectMode,
  aduPolygon,
  yardZones,
  setYardZones,
  setShowYardLabels,
}: {
  result: AnalyzeResponse | null;
  edgeSelectMode: boolean;
  setEdgeSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  aduPolygon: GeoJSON.Polygon | null;
  yardZones: YardZonesState;
  setYardZones: React.Dispatch<React.SetStateAction<YardZonesState>>;
  setShowYardLabels: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [currentZone, setCurrentZone] = useState<string>('Unknown');
  const [selectedFrontEdgePoint, setSelectedFrontEdgePoint] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const clearSelectedFrontEdgePoint = useCallback(() => {
    setSelectedFrontEdgePoint(null);
  }, []);
  const clearYardZoneSelection = useCallback(() => {
    clearSelectedFrontEdgePoint();
    setYardZones(null);
    setShowYardLabels(false);
  }, [clearSelectedFrontEdgePoint, setShowYardLabels, setYardZones]);
  const reopenFrontEdgeSelection = useCallback(() => {
    clearYardZoneSelection();
    setEdgeSelectMode(true);
  }, [clearYardZoneSelection, setEdgeSelectMode]);
  const skipFrontEdgeSelection = useCallback(() => {
    clearYardZoneSelection();
    setEdgeSelectMode(false);
  }, [clearYardZoneSelection, setEdgeSelectMode]);

  const propertyEdges = useMemo(() => {
    if (!result?.property_geojson) return [];
    const coords =
      result.property_geojson.type === 'Polygon'
        ? (result.property_geojson.coordinates as number[][][])[0]
        : (result.property_geojson.coordinates as number[][][][])[0][0];
    const edges: number[][][] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      edges.push([coords[i], coords[i + 1]]);
    }
    return edges;
  }, [result?.property_geojson]);

  const findNearestPropertyEdge = useCallback(
    (lng: number, lat: number) => {
      if (!propertyEdges.length) {
        return null;
      }

      const clickPt = turf.point([lng, lat]);
      let nearestEdge = propertyEdges[0];
      let minDist = Infinity;
      for (const edge of propertyEdges) {
        const line = turf.lineString(edge);
        const nearest = turf.nearestPointOnLine(line, clickPt);
        const dist = turf.distance(clickPt, nearest, { units: 'meters' });
        if (dist < minDist) {
          minDist = dist;
          nearestEdge = edge;
        }
      }

      return {
        edge: nearestEdge,
        distanceMeters: minDist,
      };
    },
    [propertyEdges],
  );

  const partitionYardsForEdge = useCallback(
    async (frontLotLine: number[][]) => {
      if (!result?.property_geojson) {
        return false;
      }

      try {
        const primaryStructure =
          result.detected_buildings && result.detected_buildings.length > 0
            ? result.detected_buildings[0]
            : null;

        const res = await fetch(`${API_URL}/partition-yards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify({
            property_geojson: result.property_geojson,
            front_lot_line: frontLotLine,
            primary_structure_geojson: primaryStructure,
          }),
        });

        if (!res.ok) {
          console.error('Partition yards failed:', res.statusText);
          return false;
        }

        const data = await res.json();
        setYardZones(data);
        setShowYardLabels(true);
        setTimeout(() => {
          setShowYardLabels(false);
        }, YARD_LABEL_FADE_DELAY_MS);
        return true;
      } catch (err) {
        console.error('Partition yards error:', err);
        return false;
      }
    },
    [result, setShowYardLabels, setYardZones],
  );

  const selectFrontEdgeByPoint = useCallback(
    async (point: { lng: number; lat: number }, options?: { maxDistanceMeters?: number }) => {
      if (!result?.property_geojson || propertyEdges.length === 0) {
        return false;
      }

      const nearestEdge = findNearestPropertyEdge(point.lng, point.lat);
      if (!nearestEdge) {
        return false;
      }

      if (
        options?.maxDistanceMeters !== undefined &&
        nearestEdge.distanceMeters > options.maxDistanceMeters
      ) {
        return false;
      }

      setEdgeSelectMode(false);
      const didPartitionYards = await partitionYardsForEdge(nearestEdge.edge);
      if (!didPartitionYards) {
        reopenFrontEdgeSelection();
        return false;
      }

      setSelectedFrontEdgePoint(point);
      return true;
    },
    [
      findNearestPropertyEdge,
      partitionYardsForEdge,
      propertyEdges.length,
      reopenFrontEdgeSelection,
      result?.property_geojson,
      setEdgeSelectMode,
    ],
  );

  const restoreFrontEdgeSelectionPoint = useCallback(
    async (point: { lng: number; lat: number }) => {
      const didRestore = await selectFrontEdgeByPoint(point, {
        maxDistanceMeters: RESTORED_FRONT_EDGE_MAX_DISTANCE_METERS,
      });
      if (!didRestore) {
        reopenFrontEdgeSelection();
      }
      return didRestore;
    },
    [reopenFrontEdgeSelection, selectFrontEdgeByPoint],
  );

  const handleEdgeSelect = useCallback(
    async (e: { lngLat: { lng: number; lat: number } }) => {
      if (!edgeSelectMode) return;
      const nextPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      await selectFrontEdgeByPoint(nextPoint);
    },
    [edgeSelectMode, selectFrontEdgeByPoint],
  );

  useEffect(() => {
    if (!result) {
      clearSelectedFrontEdgePoint();
    }
  }, [clearSelectedFrontEdgePoint, result]);

  useEffect(() => {
    if (!aduPolygon || !yardZones) {
      setCurrentZone('Unknown');
      return;
    }

    try {
      const intersectingZones: string[] = [];

      // Helper to cleanly check intersection
      const checkIntersect = (zoneFeature: any, label: string) => {
        if (!zoneFeature) return;
        try {
          if (turf.booleanIntersects(aduPolygon, zoneFeature as any)) {
            intersectingZones.push(label);
          }
        } catch (e) {
          console.warn(`Turf intersection failed for ${label}`, e);
        }
      };

      checkIntersect(yardZones.front_yard_geojson, 'Front');
      checkIntersect(yardZones.side_yard_geojson, 'Side');
      checkIntersect(yardZones.rear_yard_geojson, 'Rear');

      if (intersectingZones.length === 0) {
        setCurrentZone('Unknown');
      } else {
        setCurrentZone(intersectingZones.join(' / '));
      }
    } catch (e) {
      setCurrentZone('Error');
    }
  }, [aduPolygon, yardZones]);

  // Compute minimalist internal yard partition lines
  // We extract all segments of the yard zones. If a segment is far from the property boundary, it's an internal divider!
  const internalYardLines = useMemo(() => {
    if (!result?.property_geojson || !yardZones) return null;

    try {
      const propertyLine = turf.polygonToLine(result.property_geojson as any);
      const internalFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];

      const extractInternalSegments = (zoneGeojson: any) => {
        if (!zoneGeojson) return;
        try {
          const lines = turf.polygonToLine(zoneGeojson);
          turf.segmentEach(lines as any, (currentSegment) => {
            if (!currentSegment) return;
            const midPoint = turf.midpoint(
              turf.point(currentSegment.geometry.coordinates[0]),
              turf.point(currentSegment.geometry.coordinates[1]),
            );
            const dist = turf.pointToLineDistance(midPoint, propertyLine as any, {
              units: 'meters',
            });
            // If the midpoint is > INTERNAL_YARD_LINE_THRESHOLD_METERS from the property boundary, it is an internal partition line
            if (dist > INTERNAL_YARD_LINE_THRESHOLD_METERS) {
              internalFeatures.push(currentSegment as GeoJSON.Feature<GeoJSON.LineString>);
            }
          });
        } catch (e) {
          console.warn('Failed to extract segments for yard zone', e);
        }
      };

      extractInternalSegments(yardZones.front_yard_geojson);
      extractInternalSegments(yardZones.rear_yard_geojson);
      // We don't need side yard because front and rear internal boundaries fully encompass the side boundaries!

      return {
        type: 'FeatureCollection',
        features: internalFeatures,
      } as GeoJSON.FeatureCollection;
    } catch (e) {
      console.error('Failed to compute internal yard lines', e);
      return null;
    }
  }, [result?.property_geojson, yardZones]);

  const yardLabelPositions = useMemo(() => {
    if (!yardZones) return null;

    const positions: { name: string; lng: number; lat: number }[] = [];

    const addCentroid = (geojson: any, name: string) => {
      if (geojson) {
        try {
          // Use polylabel for better visual centering on odd-shaped polygons
          const coordinates =
            geojson.type === 'Polygon' ? geojson.coordinates : geojson.coordinates[0];

          const center = polylabel(coordinates as number[][][], POLYLABEL_PRECISION_ULTRA_FINE);
          positions.push({ name, lng: center[0], lat: center[1] });
        } catch (e) {
          // Fallback to turf.centroid if polylabel fails
          try {
            const centroid = turf.centroid(geojson);
            positions.push({
              name,
              lng: centroid.geometry.coordinates[0],
              lat: centroid.geometry.coordinates[1],
            });
          } catch (err) {
            console.warn(`Failed to compute center for ${name}`, err);
          }
        }
      }
    };

    addCentroid(yardZones.front_yard_geojson, 'Front Yard');
    addCentroid(yardZones.rear_yard_geojson, 'Rear Yard');
    addCentroid(yardZones.side_yard_geojson, 'Side Yard');

    return positions;
  }, [yardZones]);

  return {
    clearYardZoneSelection,
    propertyEdges,
    handleEdgeSelect,
    reopenFrontEdgeSelection,
    restoreFrontEdgeSelectionPoint,
    skipFrontEdgeSelection,
    internalYardLines,
    yardLabelPositions,
    currentZone,
    selectedFrontEdgePoint,
  };
}
