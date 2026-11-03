'use client';

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { AnalyzeResponse } from '@/types';

type RestorePoint = {
  lng: number;
  lat: number;
};

interface UsePendingMapRestoreEffectsParams {
  edgeSelectMode: boolean;
  pendingDisabledBuildingIndices: number[];
  pendingFrontEdgePoint: RestorePoint | null;
  result: AnalyzeResponse | null;
  restoreDisabledBuildings: (buildingIndices: number[]) => Promise<void>;
  restoreFrontEdgeSelectionPoint: (point: RestorePoint) => Promise<boolean>;
  setPendingDisabledBuildingIndices: Dispatch<SetStateAction<number[]>>;
  setPendingFrontEdgePoint: Dispatch<SetStateAction<RestorePoint | null>>;
}

export function usePendingMapRestoreEffects({
  edgeSelectMode,
  pendingDisabledBuildingIndices,
  pendingFrontEdgePoint,
  result,
  restoreDisabledBuildings,
  restoreFrontEdgeSelectionPoint,
  setPendingDisabledBuildingIndices,
  setPendingFrontEdgePoint,
}: UsePendingMapRestoreEffectsParams) {
  useEffect(() => {
    if (!result || !pendingFrontEdgePoint) {
      return;
    }

    let isActive = true;

    const restoreFrontEdge = async () => {
      const didRestore = await restoreFrontEdgeSelectionPoint(pendingFrontEdgePoint);
      if (!isActive) {
        return;
      }
      if (didRestore || edgeSelectMode) {
        setPendingFrontEdgePoint(null);
      }
    };

    void restoreFrontEdge();

    return () => {
      isActive = false;
    };
  }, [
    edgeSelectMode,
    pendingFrontEdgePoint,
    restoreFrontEdgeSelectionPoint,
    result,
    setPendingFrontEdgePoint,
  ]);

  useEffect(() => {
    if (!result || pendingDisabledBuildingIndices.length === 0) {
      return;
    }

    let isActive = true;

    const restoreBuildingExclusions = async () => {
      await restoreDisabledBuildings(pendingDisabledBuildingIndices);
      if (!isActive) {
        return;
      }
      setPendingDisabledBuildingIndices([]);
    };

    void restoreBuildingExclusions();

    return () => {
      isActive = false;
    };
  }, [
    pendingDisabledBuildingIndices,
    restoreDisabledBuildings,
    result,
    setPendingDisabledBuildingIndices,
  ]);
}
