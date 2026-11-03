import { useEffect, useMemo, useRef, useState } from 'react';
import type { AduClearance, AnalyzeResponse } from '@/types';
import type { ClearanceGuide } from '../types';
import {
  calculateDirectionalClearanceGuides,
  extractBoundarySegments,
  getAttachedSideDirection,
  getStructureBoundarySegments,
  type IndexedStructureGeometry,
} from '../utils/clearanceGuides';

type ClearanceGuideFeatureProperties = {
  direction: ClearanceGuide['direction'];
  targetKind: ClearanceGuide['targetKind'];
  label: string;
  targetStructureIndex?: number;
};

type ClearanceGuideFeature = GeoJSON.Feature<
  GeoJSON.LineString | GeoJSON.Point,
  ClearanceGuideFeatureProperties
>;

type ClearanceGuideFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString | GeoJSON.Point,
  ClearanceGuideFeatureProperties
>;

export function useAduClearanceGuides({
  aduPolygon,
  aduRotation,
  result,
  disabledBuildings,
  aduType,
  isAduValid,
  attachedReachableSecondaryIndexSet,
}: {
  aduPolygon: GeoJSON.Polygon | null;
  aduRotation: number;
  result: AnalyzeResponse | null;
  disabledBuildings: Set<number>;
  aduType: 'detached' | 'attached';
  isAduValid: boolean;
  attachedReachableSecondaryIndexSet: Set<number>;
}): {
  clearanceGuideSourceData: GeoJSON.FeatureCollection | null;
  aduClearances: AduClearance[];
} {
  const [clearanceGuides, setClearanceGuides] = useState<ClearanceGuide[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  const parcelBoundarySegments = useMemo(
    () =>
      extractBoundarySegments({
        geometry: result?.property_geojson as GeoJSON.Geometry | undefined,
        targetKind: 'parcel-boundary',
      }),
    [result?.property_geojson],
  );
  const structureBoundarySegments = useMemo(() => {
    return getStructureBoundarySegments(
      getEligibleStructures({
        result,
        disabledBuildings,
        aduType,
        attachedReachableSecondaryIndexSet,
      }),
    );
  }, [result, disabledBuildings, aduType, attachedReachableSecondaryIndexSet]);
  const attachedSideDirection = useMemo(() => {
    if (aduType !== 'attached') return null;

    const primaryStructureSegments = extractBoundarySegments({
      geometry: result?.detected_buildings?.[0] as GeoJSON.Geometry | undefined,
      targetKind: 'active-structure',
      targetStructureIndex: 0,
    });

    return getAttachedSideDirection({
      aduGeometry: aduPolygon,
      aduRotation,
      primaryStructureSegments,
    });
  }, [aduPolygon, aduRotation, aduType, result?.detected_buildings]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isAduValid || !aduPolygon) {
      setClearanceGuides([]);
      return;
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      setClearanceGuides(
        calculateClearanceGuides({
          aduPolygon,
          aduRotation,
          parcelBoundarySegments,
          structureBoundarySegments,
          hiddenDirection: attachedSideDirection,
        }),
      );
      animationFrameRef.current = null;
    });

    return () => {
      if (animationFrameRef.current === null) return;
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [
    aduPolygon,
    aduRotation,
    attachedSideDirection,
    isAduValid,
    parcelBoundarySegments,
    structureBoundarySegments,
  ]);

  return useMemo(
    () => ({
      clearanceGuideSourceData: createGuideSourceData(clearanceGuides),
      aduClearances: clearanceGuides.map(mapClearanceGuideToAduClearance),
    }),
    [clearanceGuides],
  );
}

function mapClearanceGuideToAduClearance(clearanceGuide: ClearanceGuide): AduClearance {
  return {
    direction: clearanceGuide.direction,
    targetKind: clearanceGuide.targetKind,
    distanceFeet: clearanceGuide.distanceFeet,
    targetStructureIndex: clearanceGuide.targetStructureIndex,
  };
}

function calculateClearanceGuides({
  aduPolygon,
  aduRotation,
  parcelBoundarySegments,
  structureBoundarySegments,
  hiddenDirection,
}: {
  aduPolygon: GeoJSON.Polygon | null;
  aduRotation: number;
  parcelBoundarySegments: ReturnType<typeof extractBoundarySegments>;
  structureBoundarySegments: ReturnType<typeof extractBoundarySegments>;
  hiddenDirection: ClearanceGuide['direction'] | null;
}): ClearanceGuide[] {
  if (!aduPolygon) return [];

  const guides = calculateDirectionalClearanceGuides({
    aduGeometry: aduPolygon,
    aduRotation,
    parcelBoundarySegments,
    structureBoundarySegments,
  });

  if (!hiddenDirection) return guides;

  return guides.filter((guide) => guide.direction !== hiddenDirection);
}

function getEligibleStructures({
  result,
  disabledBuildings,
  aduType,
  attachedReachableSecondaryIndexSet,
}: {
  result: AnalyzeResponse | null;
  disabledBuildings: Set<number>;
  aduType: 'detached' | 'attached';
  attachedReachableSecondaryIndexSet: Set<number>;
}): IndexedStructureGeometry[] {
  if (!result?.detected_buildings?.length) return [];

  return result.detected_buildings.reduce<IndexedStructureGeometry[]>(
    (structures, geometry, index) => {
      if (
        !isEligibleStructure({
          index,
          disabledBuildings,
          aduType,
          attachedReachableSecondaryIndexSet,
        })
      ) {
        return structures;
      }
      structures.push({ index, geometry: geometry as GeoJSON.Geometry });
      return structures;
    },
    [],
  );
}

function isEligibleStructure({
  index,
  disabledBuildings,
  aduType,
  attachedReachableSecondaryIndexSet,
}: {
  index: number;
  disabledBuildings: Set<number>;
  aduType: 'detached' | 'attached';
  attachedReachableSecondaryIndexSet: Set<number>;
}): boolean {
  if (disabledBuildings.has(index)) return false;
  if (aduType !== 'attached') return true;
  if (index === 0) return false;
  return attachedReachableSecondaryIndexSet.has(index);
}

function createGuideSourceData(guides: ClearanceGuide[]): ClearanceGuideFeatureCollection | null {
  if (!guides.length) return null;

  return {
    type: 'FeatureCollection',
    features: guides.flatMap((guide) => [
      createGuideLineFeature(guide),
      createGuideLabelFeature(guide),
    ]),
  };
}

function createGuideLineFeature(guide: ClearanceGuide): ClearanceGuideFeature {
  return {
    type: 'Feature',
    properties: createGuideProperties(guide),
    geometry: {
      type: 'LineString',
      coordinates: [guide.aduPoint, guide.targetPoint],
    },
  };
}

function createGuideLabelFeature(guide: ClearanceGuide): ClearanceGuideFeature {
  return {
    type: 'Feature',
    properties: createGuideProperties(guide),
    geometry: {
      type: 'Point',
      coordinates: getGuideMidpoint(guide),
    },
  };
}

function createGuideProperties(guide: ClearanceGuide): ClearanceGuideFeatureProperties {
  return {
    direction: guide.direction,
    targetKind: guide.targetKind,
    label: `${guide.distanceFeet.toFixed(1)} ft`,
    targetStructureIndex: guide.targetStructureIndex,
  };
}

function getGuideMidpoint(guide: ClearanceGuide): [number, number] {
  return [
    (guide.aduPoint[0] + guide.targetPoint[0]) / 2,
    (guide.aduPoint[1] + guide.targetPoint[1]) / 2,
  ];
}
