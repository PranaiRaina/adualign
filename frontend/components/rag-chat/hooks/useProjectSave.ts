'use client';

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  buildPlanningDraftScopeKey,
  coerceMapSnapshot,
  readPlanningDraft,
  updatePlanningDraft,
  type MapSnapshot,
} from '@/lib/planningDraft';
import type { PlanningDraft } from '@/lib/planningDraft';
import { buildPlanningSessionDirtySnapshot } from '@/lib/planningDirtyState';
import {
  persistPlanningProject,
  promotePlanningDraftScopeOnCreate,
} from '@/lib/planningProjectLifecycle';
import type { PropertyContext } from '@/types';
import { getUserFacingErrorMessage } from '../api';
import { buildAduClearancePayload } from '../mappers';
import type { CalculatorResponse, ProjectPreferences, ProjectSavePayload } from '../types';

type UseProjectSaveArgs = {
  activeProjectId?: string;
  apiBaseUrl: string;
  applyDirtyBaseline: (snapshot: string) => void;
  ensureProjectIdInUrl: (projectId: string) => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  hasHydratedMapSnapshotRef: MutableRefObject<boolean>;
  hydratedMapSnapshotRef: MutableRefObject<unknown | null>;
  isAuthLoading: boolean;
  isLoggedIn: boolean;
  localContext?: PropertyContext;
  markProjectHydrated: (projectId: string) => void;
  openPlanningAuthModal: () => void;
  planningDraftScopeKey: string;
  planningMapSnapshot: MapSnapshot | null;
  projectPreferences: ProjectPreferences;
  refreshCalculator: () => Promise<CalculatorResponse | undefined>;
  resetHydrationState: () => void;
  setActiveProjectId: Dispatch<SetStateAction<string | undefined>>;
  setError: (message: string | null) => void;
  setIsSaving: (value: boolean) => void;
  setPlanningMapSnapshot: Dispatch<SetStateAction<MapSnapshot | null>>;
};

function resolveMapSnapshotForSave(args: {
  hasHydratedMapSnapshot: boolean;
  hydratedMapSnapshot: unknown | null;
  isExistingProject: boolean;
  storedPlanningDraft: PlanningDraft | null;
}): { shouldInclude: boolean; value: unknown | null } {
  if (args.storedPlanningDraft?.mapSnapshot) {
    return {
      shouldInclude: true,
      value: args.storedPlanningDraft.mapSnapshot,
    };
  }

  if (args.hasHydratedMapSnapshot) {
    return {
      shouldInclude: true,
      value: args.hydratedMapSnapshot,
    };
  }

  return {
    shouldInclude: !args.isExistingProject,
    value: null,
  };
}

function buildProjectSavePayload(args: {
  calculatorResponse: CalculatorResponse;
  localContext?: PropertyContext;
  mapSnapshotForSave: { shouldInclude: boolean; value: unknown | null };
  projectPreferences: ProjectPreferences;
}): ProjectSavePayload {
  const { calculatorResponse, localContext, mapSnapshotForSave, projectPreferences } = args;
  const projectSavePayload: ProjectSavePayload = {
    address: localContext?.address ?? null,
    county: localContext?.county ?? null,
    property_area_sqft: localContext?.propertyArea ?? null,
    home_sqft: localContext?.homeSqft ?? null,
    buildable_area_sqft: localContext?.buildableArea ?? null,
    setback_ft: localContext?.setback ?? null,
    max_adu_sqft: localContext?.maxAduSqft ?? null,
    adu_sqft: localContext?.aduSize ?? null,
    adu_shape: localContext?.aduShape ?? null,
    adu_type: localContext?.aduType ?? null,
    primary_use: projectPreferences.primaryUse ?? null,
    blocker_types: projectPreferences.blockerTypes,
    fire_hazard_severity: localContext?.fireHazardSeverity ?? null,
    fire_hazard_zone_type: localContext?.fireHazardZoneType ?? null,
    current_yard_zone: localContext?.currentYardZone ?? null,
    adu_clearances: buildAduClearancePayload(localContext),
    finance_state: calculatorResponse.finance_state,
  };

  if (localContext?.aduWidthFt != null) {
    projectSavePayload.adu_width_ft = localContext.aduWidthFt;
  }
  if (localContext?.aduLengthFt != null) {
    projectSavePayload.adu_length_ft = localContext.aduLengthFt;
  }

  if (mapSnapshotForSave.shouldInclude) {
    projectSavePayload.map_snapshot = mapSnapshotForSave.value;
  }

  return projectSavePayload;
}

function getBearerToken(headers: Record<string, string>): string {
  const authorizationHeader = headers.Authorization;
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new Error('Authentication is required to save this project.');
  }

  return authorizationHeader.slice('Bearer '.length);
}

export function useProjectSave({
  activeProjectId,
  apiBaseUrl,
  applyDirtyBaseline,
  ensureProjectIdInUrl,
  getAuthHeaders,
  hasHydratedMapSnapshotRef,
  hydratedMapSnapshotRef,
  isAuthLoading,
  isLoggedIn,
  localContext,
  markProjectHydrated,
  openPlanningAuthModal,
  planningDraftScopeKey,
  planningMapSnapshot,
  projectPreferences,
  refreshCalculator,
  resetHydrationState,
  setActiveProjectId,
  setError,
  setIsSaving,
  setPlanningMapSnapshot,
}: UseProjectSaveArgs) {
  const handleSaveProject = useCallback(async (): Promise<string | undefined> => {
    if (isAuthLoading) {
      return undefined;
    }
    if (!isLoggedIn) {
      openPlanningAuthModal();
      return undefined;
    }

    setIsSaving(true);
    setError(null);

    const previousProjectId = activeProjectId;
    let savedProjectId = previousProjectId;

    try {
      const calculatorResponse = await refreshCalculator();
      if (!calculatorResponse) {
        return undefined;
      }

      const authHeaders = await getAuthHeaders();
      const token = getBearerToken(authHeaders);
      const storedPlanningDraft = readPlanningDraft(planningDraftScopeKey);
      const mapSnapshotForSave = resolveMapSnapshotForSave({
        hasHydratedMapSnapshot: hasHydratedMapSnapshotRef.current,
        hydratedMapSnapshot: hydratedMapSnapshotRef.current,
        isExistingProject: !!savedProjectId,
        storedPlanningDraft,
      });
      const projectSavePayload = buildProjectSavePayload({
        calculatorResponse,
        localContext,
        mapSnapshotForSave,
        projectPreferences,
      });
      const resolvedPlanningMapSnapshot = mapSnapshotForSave.shouldInclude
        ? coerceMapSnapshot(mapSnapshotForSave.value)
        : planningMapSnapshot;

      savedProjectId = await persistPlanningProject({
        projectId: savedProjectId,
        apiBaseUrl,
        token,
        payload: { ...projectSavePayload },
      });
      promotePlanningDraftScopeOnCreate({
        previousProjectId,
        savedProjectId,
        fromScopeKey: planningDraftScopeKey,
      });
      updatePlanningDraft(buildPlanningDraftScopeKey(savedProjectId), {
        financeState: calculatorResponse.finance_state,
        mapSnapshot: resolvedPlanningMapSnapshot,
        propertyContext: localContext ?? null,
      });

      applyDirtyBaseline(
        buildPlanningSessionDirtySnapshot({
          financeState: calculatorResponse.finance_state,
          mapSnapshot: resolvedPlanningMapSnapshot,
          propertyContext: localContext,
        }),
      );
      markProjectHydrated(savedProjectId);
      if (mapSnapshotForSave.shouldInclude) {
        hasHydratedMapSnapshotRef.current = true;
        hydratedMapSnapshotRef.current = mapSnapshotForSave.value;
      }
      setPlanningMapSnapshot(resolvedPlanningMapSnapshot);
      setActiveProjectId(savedProjectId);
      ensureProjectIdInUrl(savedProjectId);
      return savedProjectId;
    } catch (error) {
      if (!previousProjectId && savedProjectId) {
        resetHydrationState();
        setActiveProjectId(savedProjectId);
        ensureProjectIdInUrl(savedProjectId);
      }

      console.error('Save failed:', error);
      setError(getUserFacingErrorMessage('saveProject', error));
      return undefined;
    } finally {
      setIsSaving(false);
    }
  }, [
    activeProjectId,
    apiBaseUrl,
    applyDirtyBaseline,
    ensureProjectIdInUrl,
    getAuthHeaders,
    hasHydratedMapSnapshotRef,
    hydratedMapSnapshotRef,
    isAuthLoading,
    isLoggedIn,
    localContext,
    markProjectHydrated,
    openPlanningAuthModal,
    planningDraftScopeKey,
    planningMapSnapshot,
    projectPreferences,
    refreshCalculator,
    resetHydrationState,
    setActiveProjectId,
    setError,
    setIsSaving,
    setPlanningMapSnapshot,
  ]);

  return { handleSaveProject };
}
