'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AnalyzeResponse, FinanceStateSnapshot } from '@/types';
import {
  buildPlanningDraftScopeKey,
  clearPlanningDraft,
  coerceMapSnapshot,
  readPlanningDraft,
  type MapSnapshot,
} from '@/lib/planningDraft';
import {
  buildPlanningDirtySnapshotFromProject,
  buildPlanningSessionDirtySnapshot,
} from '@/lib/planningDirtyState';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { usePendingMapRestoreEffects } from './usePendingMapRestoreEffects';
import type { MapLocation } from '../types';

const RAG_API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const LOCATION_MATCH_TOLERANCE = 0.000001;

export type BackendSnapshotRestoreStatus =
  | 'not-needed'
  | 'idle'
  | 'loading'
  | 'restored'
  | 'missing'
  | 'invalid';

type ProjectMapSnapshotResponse = {
  address?: string | null;
  county?: string | null;
  adu_type?: string | null;
  property_area_sqft?: number | null;
  buildable_area_sqft?: number | null;
  setback_ft?: number | null;
  max_adu_sqft?: number | null;
  adu_sqft?: number | null;
  adu_width_ft?: number | null;
  adu_length_ft?: number | null;
  adu_shape?: string | null;
  fire_hazard_severity?: string | null;
  fire_hazard_zone_type?: string | null;
  current_yard_zone?: string | null;
  adu_clearances?: Array<{
    direction: 'top' | 'right' | 'bottom' | 'left';
    target_kind: 'parcel-boundary' | 'active-structure';
    distance_feet: number;
    target_structure_index?: number | null;
  }> | null;
  finance_state?: FinanceStateSnapshot | null;
  map_snapshot?: unknown;
};

type RestorePoint = {
  lng: number;
  lat: number;
};

type BackendSnapshotRestoreState = {
  status: BackendSnapshotRestoreStatus;
  pendingSnapshot: MapSnapshot | null;
  pendingFrontEdgePoint: RestorePoint | null;
  pendingDisabledBuildingIndices: number[];
};

export type BackendSnapshotRestore = {
  actions: {
    markSnapshotHandled: () => void;
  };
  flags: {
    isProjectInvalid: boolean;
    shouldWaitForBackendSnapshot: boolean;
  };
  state: BackendSnapshotRestoreState;
};

interface UseBackendSnapshotRestoreParams {
  activeProjectId?: string;
  edgeSelectMode: boolean;
  handleAddressResult: (lng: number, lat: number, placeName: string) => void;
  initialDraftMapSnapshot: MapSnapshot | null;
  isAuthLoading: boolean;
  isLoggedIn: boolean;
  onPlanningDirtyBaselineResolved: (
    snapshot: string,
    financeState: FinanceStateSnapshot | null,
    shouldPromoteLiveBaseline: boolean,
  ) => void;
  onDirtyComparisonReadyChange: (ready: boolean) => void;
  restoreDisabledBuildings: (buildingIndices: number[]) => Promise<void>;
  restoreFrontEdgeSelectionPoint: (point: RestorePoint) => Promise<boolean>;
  result: AnalyzeResponse | null;
  selectedLocation: MapLocation | null;
}

function createInitialRestoreStatus(
  activeProjectId: string | undefined,
): BackendSnapshotRestoreStatus {
  return activeProjectId ? 'idle' : 'not-needed';
}

function areRestoreLocationsEqual(
  selectedLocation: MapLocation | null,
  restoreLocation: MapLocation,
) {
  if (!selectedLocation) {
    return false;
  }

  return (
    Math.abs(selectedLocation.lat - restoreLocation.lat) <= LOCATION_MATCH_TOLERANCE &&
    Math.abs(selectedLocation.lng - restoreLocation.lng) <= LOCATION_MATCH_TOLERANCE
  );
}

export function useBackendSnapshotRestore({
  activeProjectId,
  edgeSelectMode,
  handleAddressResult,
  initialDraftMapSnapshot,
  isAuthLoading,
  isLoggedIn,
  onPlanningDirtyBaselineResolved,
  onDirtyComparisonReadyChange,
  restoreDisabledBuildings,
  restoreFrontEdgeSelectionPoint,
  result,
  selectedLocation,
}: UseBackendSnapshotRestoreParams): BackendSnapshotRestore {
  const activePlanningDraft = useMemo(
    () => readPlanningDraft(buildPlanningDraftScopeKey(activeProjectId)),
    [activeProjectId],
  );
  const activeDraftMapSnapshot = activePlanningDraft?.mapSnapshot ?? null;
  const [pendingSnapshot, setPendingSnapshot] = useState<MapSnapshot | null>(
    initialDraftMapSnapshot,
  );
  const [pendingFrontEdgePoint, setPendingFrontEdgePoint] = useState<RestorePoint | null>(
    initialDraftMapSnapshot?.frontEdgeSelectionPoint ?? null,
  );
  const [pendingDisabledBuildingIndices, setPendingDisabledBuildingIndices] = useState<number[]>(
    initialDraftMapSnapshot?.disabledBuildingIndices ?? [],
  );
  const [status, setStatus] = useState<BackendSnapshotRestoreStatus>(() =>
    createInitialRestoreStatus(activeProjectId),
  );

  const requestProjectIdRef = useRef<string | null>(null);
  const statusRef = useRef<BackendSnapshotRestoreStatus>(
    createInitialRestoreStatus(activeProjectId),
  );
  const previousActiveProjectIdRef = useRef<string | undefined>(activeProjectId);
  const resultRef = useRef(result);
  const selectedLocationRef = useRef(selectedLocation);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
  }, [selectedLocation]);

  const markSnapshotHandled = useCallback(() => {
    setPendingSnapshot(null);
  }, []);

  const shouldWaitForBackendSnapshot = Boolean(
    activeProjectId &&
    (isAuthLoading || (isLoggedIn && (status === 'idle' || status === 'loading'))),
  );

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const previousProjectId = previousActiveProjectIdRef.current;
    previousActiveProjectIdRef.current = activeProjectId;

    requestProjectIdRef.current = null;
    setPendingSnapshot(activeDraftMapSnapshot);
    setPendingFrontEdgePoint(activeDraftMapSnapshot?.frontEdgeSelectionPoint ?? null);
    setPendingDisabledBuildingIndices(activeDraftMapSnapshot?.disabledBuildingIndices ?? []);

    if (!activeProjectId) {
      setStatus('not-needed');
      return;
    }

    const isInSessionSavePromotion =
      !previousProjectId &&
      resultRef.current &&
      activeDraftMapSnapshot &&
      areRestoreLocationsEqual(
        selectedLocationRef.current,
        activeDraftMapSnapshot.selectedLocation,
      );

    if (isInSessionSavePromotion) {
      setPendingSnapshot(null);
      setPendingFrontEdgePoint(null);
      setPendingDisabledBuildingIndices([]);
      setStatus('restored');
      requestProjectIdRef.current = activeProjectId;
      return;
    }

    setStatus('idle');
  }, [activeDraftMapSnapshot, activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    if (isAuthLoading) {
      return;
    }

    if (!isLoggedIn) {
      setStatus('missing');
      return;
    }

    if (statusRef.current !== 'idle') {
      return;
    }

    if (requestProjectIdRef.current === activeProjectId) {
      return;
    }

    let isCancelled = false;
    requestProjectIdRef.current = activeProjectId;
    setStatus('loading');

    const loadProjectMapSnapshot = async () => {
      try {
        const res = await fetch(`${RAG_API_URL}/projects/${activeProjectId}`, {
          headers: await getAuthHeaders(),
        });

        if (res.status === 404) {
          if (!isCancelled) {
            clearPlanningDraft(buildPlanningDraftScopeKey(activeProjectId), 'project-not-found');
            setPendingSnapshot(null);
            setPendingFrontEdgePoint(null);
            setPendingDisabledBuildingIndices([]);
            setStatus('invalid');
          }
          return;
        }

        if (!res.ok) {
          if (!isCancelled) {
            setStatus('missing');
          }
          return;
        }

        const project = (await res.json()) as ProjectMapSnapshotResponse;
        const nextSnapshot = activeDraftMapSnapshot ?? coerceMapSnapshot(project.map_snapshot);

        if (isCancelled) {
          return;
        }

        const baselineSnapshot = activePlanningDraft
          ? buildPlanningSessionDirtySnapshot({
              project,
              planningDraft: activePlanningDraft,
              mapSnapshot: nextSnapshot,
            })
          : buildPlanningDirtySnapshotFromProject(project);

        // Always promote the live (settled) map state as the dirty baseline,
        // regardless of whether a planning draft exists. The project/draft-derived
        // baseline is recomputed live on the map (bbox dims, clearances, yard
        // zones) and rarely byte-matches the stored values, which would otherwise
        // surface as a spurious "Save Project" on a clean map.
        onPlanningDirtyBaselineResolved(
          baselineSnapshot,
          activePlanningDraft?.financeState ?? project.finance_state ?? null,
          true,
        );
        setPendingSnapshot(nextSnapshot);
        setPendingFrontEdgePoint(nextSnapshot?.frontEdgeSelectionPoint ?? null);
        setPendingDisabledBuildingIndices(nextSnapshot?.disabledBuildingIndices ?? []);
        setStatus('restored');
        if (
          !nextSnapshot ||
          areRestoreLocationsEqual(selectedLocation, nextSnapshot.selectedLocation)
        ) {
          return;
        }

        handleAddressResult(
          nextSnapshot.selectedLocation.lng,
          nextSnapshot.selectedLocation.lat,
          nextSnapshot.selectedLocation.name,
        );
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load project map snapshot:', error);
          setStatus('missing');
        }
      }
    };

    void loadProjectMapSnapshot();

    return () => {
      isCancelled = true;
    };
  }, [
    activeDraftMapSnapshot,
    activePlanningDraft,
    activeProjectId,
    handleAddressResult,
    isAuthLoading,
    isLoggedIn,
    onPlanningDirtyBaselineResolved,
    selectedLocation,
  ]);

  useEffect(() => {
    if (!activeProjectId) {
      onDirtyComparisonReadyChange(true);
      return;
    }

    if (status !== 'restored') {
      onDirtyComparisonReadyChange(false);
      return;
    }

    onDirtyComparisonReadyChange(
      pendingSnapshot === null &&
        pendingFrontEdgePoint === null &&
        pendingDisabledBuildingIndices.length === 0,
    );
  }, [
    activeProjectId,
    onDirtyComparisonReadyChange,
    pendingDisabledBuildingIndices.length,
    pendingFrontEdgePoint,
    pendingSnapshot,
    status,
  ]);
  usePendingMapRestoreEffects({
    edgeSelectMode,
    pendingDisabledBuildingIndices,
    pendingFrontEdgePoint,
    result,
    restoreDisabledBuildings,
    restoreFrontEdgeSelectionPoint,
    setPendingDisabledBuildingIndices,
    setPendingFrontEdgePoint,
  });

  return {
    actions: {
      markSnapshotHandled,
    },
    flags: {
      isProjectInvalid: status === 'invalid',
      shouldWaitForBackendSnapshot,
    },
    state: {
      status,
      pendingSnapshot,
      pendingFrontEdgePoint,
      pendingDisabledBuildingIndices,
    },
  };
}
