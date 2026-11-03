'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AduClearance, AnalyzeResponse, FinanceStateSnapshot, PropertyContext } from '@/types';
import {
  buildPlanningDraftScopeKey,
  clearPlanningDraft,
  readPlanningDraft,
  updatePlanningDraft,
  type MapSnapshot,
} from '@/lib/planningDraft';
import {
  EMPTY_PLANNING_DIRTY_SNAPSHOT,
  buildPlanningDirtySnapshot,
  buildPlanningSessionDirtySnapshot,
} from '@/lib/planningDirtyState';
import {
  promotePlanningDraftScopeOnCreate,
  resolveEffectiveProjectId,
} from '@/lib/planningProjectLifecycle';
import { createClient } from '@/lib/utils/supabase/client';
import { API_URL } from '../constants';
import {
  buildDraftProjectPayload,
  persistDraftProject,
  planChatContextFromPropertyContext,
} from '../createDraftProject';
import {
  buildStandaloneMapUrl,
  createMapSessionState,
  type MapSessionState,
} from '../mapSessionBootstrap';
import { calculateMapFinanceState } from '../saveMapProject';
import type { AddressSelectionOptions, MapLaunchContext, MapLocation, ShapeType } from '../types';
import type { AduBboxDimensions } from '../utils/aduDimensions';
import { useMapExitGuard } from './useMapExitGuard';

export type PlanChatContext = {
  currentYardZone?: string;
  fireHazardSeverity?: string;
  fireHazardZoneType?: string;
  aduClearances?: AduClearance[];
};

interface UseMapSessionLifecycleParams {
  launchContext: MapLaunchContext;
  restoredInitialAddress?: string;
  restoredInitialLocation?: MapLocation;
  selectedLocation: MapLocation | null;
  isLoading: boolean;
  result: AnalyzeResponse | null;
  isLoggedIn: boolean;
  selectLocationFromAddress: (
    lng: number,
    lat: number,
    placeName: string,
    options?: AddressSelectionOptions,
  ) => void;
  resetMapSession: () => void;
  resetDisabledBuildings: () => void;
  setError: (message: string | null) => void;
  aduSize: number;
  aduBboxDimensions: AduBboxDimensions | null;
  aduShapeType: ShapeType;
  aduType: 'detached' | 'attached';
  currentMapSnapshot: MapSnapshot | null;
  currentPropertyContext: PropertyContext | null;
  hasInvalidPlacement: boolean;
}

type PlanningDirtyBaseline = {
  isResolved: boolean;
  projectId?: string;
  snapshot: string;
};

type AutosaveResult = {
  status: 'saved' | 'blocked_invalid' | 'cannot_save';
  projectId?: string;
  scopeKey?: string;
};

const PROJECTS_PATH = '/projects';

// After a project's map state is restored, live values (ADU bbox dimensions,
// clearances, yard zones) keep settling across several renders. We wait this
// long, anchored on the restore-ready signal, before adopting the live snapshot
// as the dirty baseline so transient settling never registers as a real edit.
const BASELINE_PROMOTION_DELAY_MS = 600;

function createInitialSearchValue(
  restoredInitialAddress: string | undefined,
  restoredInitialLocation: MapLocation | undefined,
) {
  return restoredInitialAddress ?? restoredInitialLocation?.name ?? '';
}

function readProjectPlanningDraft(projectId?: string) {
  if (!projectId) {
    return null;
  }

  return readPlanningDraft(buildPlanningDraftScopeKey(projectId));
}

function createPlanningDirtyBaseline(projectId?: string): PlanningDirtyBaseline {
  if (projectId) {
    return {
      isResolved: false,
      projectId,
      snapshot: EMPTY_PLANNING_DIRTY_SNAPSHOT,
    };
  }

  return {
    isResolved: true,
    projectId,
    snapshot: EMPTY_PLANNING_DIRTY_SNAPSHOT,
  };
}

function createMapSearchId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `map-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clearPlanningDraftScopesForLookupFailure(activeScopeKey: string) {
  clearPlanningDraft(activeScopeKey, 'map-lookup-failed');

  const ephemeralScopeKey = buildPlanningDraftScopeKey();
  if (ephemeralScopeKey !== activeScopeKey) {
    clearPlanningDraft(ephemeralScopeKey, 'map-lookup-failed');
  }
}

function hasUnsavedMapChanges({
  activeProjectId,
  baseline,
  currentPlanningSnapshot,
  hasMeaningfulMapDraftState,
}: {
  activeProjectId?: string;
  baseline: PlanningDirtyBaseline;
  currentPlanningSnapshot: string;
  hasMeaningfulMapDraftState: boolean;
}): boolean {
  if (!hasMeaningfulMapDraftState) {
    return false;
  }

  if (!activeProjectId) {
    return true;
  }

  if (!baseline.isResolved || baseline.projectId !== activeProjectId) {
    return false;
  }

  return baseline.snapshot !== currentPlanningSnapshot;
}

function buildPlanChatUrl({
  activeProjectId,
  aduBboxDimensions,
  aduShapeType,
  aduSize,
  aduType,
  isChatSession,
  planChatContext,
  result,
  selectedLocation,
}: {
  activeProjectId?: string;
  aduBboxDimensions: AduBboxDimensions | null;
  aduShapeType: ShapeType;
  aduSize: number;
  aduType: 'detached' | 'attached';
  isChatSession: boolean;
  planChatContext?: PlanChatContext;
  result: AnalyzeResponse;
  selectedLocation: MapLocation | null;
}) {
  const params = new URLSearchParams({
    fromMap: '1',
    ...(isChatSession ? { mapReturn: '1' } : {}),
    aduSize: String(aduSize),
    aduShape: aduShapeType,
    aduType,
    setback: String(result.setback_ft ?? 4),
    propertyArea: String(result.property_area_sqft ?? 0),
    buildableArea: String(result.buildable_area_sqft ?? 0),
    maxAduSqft: String(result.max_adu_sqft ?? 1200),
  });

  if (selectedLocation) {
    params.set('address', selectedLocation.name);
    params.set('lat', String(selectedLocation.lat));
    params.set('lng', String(selectedLocation.lng));
  }

  if (activeProjectId) {
    params.set('projectId', activeProjectId);
  }

  if (aduBboxDimensions) {
    params.set('aduWidthFt', String(aduBboxDimensions.widthFt));
    params.set('aduLengthFt', String(aduBboxDimensions.lengthFt));
  }

  if (result.county) {
    params.set('county', result.county);
  }

  if (result.home_sqft != null) {
    params.set('homeSqft', String(result.home_sqft));
  }

  if (result.apn) {
    params.set('apn', result.apn);
  }

  const fireHazardSeverity = planChatContext?.fireHazardSeverity ?? result.fire_hazard?.severity;
  const fireHazardZoneType = planChatContext?.fireHazardZoneType ?? result.fire_hazard?.zone_type;
  if (fireHazardSeverity) {
    params.set('fireHazardSeverity', fireHazardSeverity);
  }
  if (fireHazardZoneType) {
    params.set('fireHazardZoneType', fireHazardZoneType);
  }

  if (planChatContext?.currentYardZone && planChatContext.currentYardZone !== 'Unknown') {
    params.set('currentYardZone', planChatContext.currentYardZone);
  }

  if (planChatContext?.aduClearances?.length) {
    params.set('aduClearances', JSON.stringify(planChatContext.aduClearances));
  }

  return `/adu-chat?${params.toString()}`;
}

function mergeStoredFireHazardContext(
  planChatContext: PlanChatContext | undefined,
  launchContext: MapLaunchContext,
): PlanChatContext | undefined {
  const fireHazardSeverity = launchContext.initialPlanningContext?.fireHazardSeverity;
  const fireHazardZoneType = launchContext.initialPlanningContext?.fireHazardZoneType;
  if (!fireHazardSeverity && !fireHazardZoneType) {
    return planChatContext;
  }
  return {
    ...planChatContext,
    fireHazardSeverity,
    fireHazardZoneType,
  };
}

export function useMapSessionLifecycle({
  launchContext,
  restoredInitialAddress,
  restoredInitialLocation,
  selectedLocation,
  isLoading,
  result,
  isLoggedIn,
  selectLocationFromAddress,
  resetMapSession,
  resetDisabledBuildings,
  setError,
  aduSize,
  aduBboxDimensions,
  aduShapeType,
  aduType,
  currentMapSnapshot,
  currentPropertyContext,
  hasInvalidPlacement,
}: UseMapSessionLifecycleParams) {
  const { isFromChat, projectId, mapSearchId } = launchContext;
  const router = useRouter();
  const [mapSession, setMapSession] = useState<MapSessionState>(() =>
    createMapSessionState({
      initialAddress: restoredInitialAddress,
      isFromChat,
      projectId,
      mapSearchId,
    }),
  );
  const [searchValue, setSearchValue] = useState(() =>
    createInitialSearchValue(restoredInitialAddress, restoredInitialLocation),
  );
  const [isProjectActionPending, setIsProjectActionPending] = useState(false);
  const [planningDirtyBaseline, setPlanningDirtyBaseline] = useState(() =>
    createPlanningDirtyBaseline(projectId),
  );
  const [workingPlanningFinanceState, setWorkingPlanningFinanceState] =
    useState<FinanceStateSnapshot | null>(
      () => readProjectPlanningDraft(projectId)?.financeState ?? null,
    );
  const [isDirtyComparisonReady, setIsDirtyComparisonReady] = useState(() => !projectId);
  const [shouldPromoteLiveDirtyBaseline, setShouldPromoteLiveDirtyBaseline] = useState(false);
  const isProjectActionPendingRef = useRef(false);

  const isChatSession = mapSession.isFromChat;
  const activeProjectId = resolveEffectiveProjectId({
    sessionProjectId: mapSession.projectId,
    routeProjectId: projectId,
  });
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  // Tracks whether the launch re-init effect has run its initial setup, so we can
  // ignore later incidental launchContext changes for the project we're already on.
  const hasInitializedLaunchRef = useRef(false);
  const resumeAddress = mapSession.resumeAddress;
  const planningDraftScopeKey = buildPlanningDraftScopeKey(activeProjectId);
  const hasMeaningfulMapDraftState = Boolean(isLoading || result);
  const currentPlanningSnapshot = buildPlanningDirtySnapshot({
    financeState: workingPlanningFinanceState,
    mapSnapshot: currentMapSnapshot,
    propertyContext: currentPropertyContext,
  });
  const currentPlanningSnapshotRef = useRef(currentPlanningSnapshot);
  currentPlanningSnapshotRef.current = currentPlanningSnapshot;
  const hasLivePlanningInputs = Boolean(currentMapSnapshot && currentPropertyContext);
  const isMapSessionDirty =
    isLoggedIn &&
    isDirtyComparisonReady &&
    !shouldPromoteLiveDirtyBaseline &&
    hasUnsavedMapChanges({
      activeProjectId,
      baseline: planningDirtyBaseline,
      currentPlanningSnapshot,
      hasMeaningfulMapDraftState,
    });
  const clearPlanningDraftForExit = useCallback(
    (reason: string, cleanupScopeKey?: string) => {
      clearPlanningDraft(cleanupScopeKey ?? planningDraftScopeKey, reason);
    },
    [planningDraftScopeKey],
  );
  const {
    bypassGuard,
    guardAction,
    guardInvalidPlacementAction,
    handleLeave: handleMapExitLeave,
    handleStay: handleMapExitStay,
    isModalOpen: isMapExitModalOpen,
    modalMode: mapExitModalMode,
  } = useMapExitGuard(
    hasInvalidPlacement,
    isMapSessionDirty,
    clearPlanningDraftForExit,
    async () => {
      const autosaveResult = await handleAutosaveProject();
      return autosaveResult.status === 'saved' ? autosaveResult.scopeKey : undefined;
    },
    activeProjectId,
  );

  const commitMapUrl = useCallback((nextUrl: string) => {
    // Update the address bar without a Next.js navigation: a router.replace
    // re-renders the map page's server component with new searchParams, which
    // changes mapSessionKey and remounts MapInterface mid-session (losing
    // in-memory state like autoAnalyze: false, so the fresh mount treated the
    // URL location as an initial launch and auto-analyzed). Same pattern as
    // syncMapProjectIdInUrl below. Next >=14.1 keeps the router in sync with
    // native history calls.
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  const syncMapProjectIdInUrl = useCallback((savedProjectId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('projectId', savedProjectId);
    const nextUrl = `/map?${params.toString()}`;
    // Update the address bar without a Next.js navigation so MapInterface is not remounted.
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  const handleAddressResult = useCallback(
    (lng: number, lat: number, placeName: string, options?: AddressSelectionOptions) => {
      resetDisabledBuildings();
      setSearchValue(placeName);
      selectLocationFromAddress(lng, lat, placeName, options);
    },
    [resetDisabledBuildings, selectLocationFromAddress],
  );

  const handleReset = useCallback(() => {
    clearPlanningDraft(planningDraftScopeKey, 'map-reset');
    setPlanningDirtyBaseline(createPlanningDirtyBaseline());
    setWorkingPlanningFinanceState(null);
    setIsDirtyComparisonReady(true);
    setShouldPromoteLiveDirtyBaseline(false);
    resetDisabledBuildings();
    setSearchValue('');
    resetMapSession();
  }, [planningDraftScopeKey, resetDisabledBuildings, resetMapSession]);

  const handleLookupFailureCleanup = useCallback(() => {
    clearPlanningDraftScopesForLookupFailure(planningDraftScopeKey);
  }, [planningDraftScopeKey]);

  const detachChatSession = useCallback(() => {
    setPlanningDirtyBaseline(createPlanningDirtyBaseline());
    setWorkingPlanningFinanceState(null);
    setIsDirtyComparisonReady(true);
    setShouldPromoteLiveDirtyBaseline(false);
    setMapSession({
      isFromChat: false,
      projectId: null,
      resumeAddress: undefined,
      mapSearchId: undefined,
    });
  }, []);

  const startStandaloneSession = useCallback(
    (location?: MapLocation, options?: AddressSelectionOptions) => {
      clearPlanningDraft(
        planningDraftScopeKey,
        location ? 'map-switch-property' : 'map-start-new-project',
      );
      detachChatSession();

      if (!location) {
        handleReset();
        commitMapUrl('/map');
        return;
      }

      const nextMapSearchId = createMapSearchId();
      setMapSession((prev) => ({ ...prev, projectId: null, mapSearchId: nextMapSearchId }));
      handleAddressResult(location.lng, location.lat, location.name, options);
      commitMapUrl(buildStandaloneMapUrl(location, nextMapSearchId));
    },
    [commitMapUrl, detachChatSession, handleAddressResult, handleReset, planningDraftScopeKey],
  );

  const handlePlanningDirtyBaselineResolved = useCallback(
    (
      snapshot: string,
      financeState: FinanceStateSnapshot | null,
      shouldPromoteLiveBaseline: boolean,
    ) => {
      if (!activeProjectId) {
        return;
      }

      setPlanningDirtyBaseline({
        isResolved: true,
        projectId: activeProjectId,
        snapshot,
      });
      setWorkingPlanningFinanceState((currentFinanceState) => currentFinanceState ?? financeState);
      setShouldPromoteLiveDirtyBaseline(shouldPromoteLiveBaseline);
    },
    [activeProjectId],
  );

  const promoteSavedPlanningDirtyBaseline = useCallback(
    (
      savedProjectId: string,
      savedPlanningSnapshot: string,
      financeState: FinanceStateSnapshot | null,
    ) => {
      setPlanningDirtyBaseline({
        isResolved: true,
        projectId: savedProjectId,
        snapshot: savedPlanningSnapshot,
      });
      setWorkingPlanningFinanceState(financeState);
      setIsDirtyComparisonReady(true);
      setShouldPromoteLiveDirtyBaseline(false);
    },
    [],
  );

  const handleDirtyComparisonReadyChange = useCallback((ready: boolean) => {
    setIsDirtyComparisonReady(ready);
  }, []);

  useEffect(() => {
    if (
      !shouldPromoteLiveDirtyBaseline ||
      !activeProjectId ||
      !isDirtyComparisonReady ||
      !hasLivePlanningInputs
    ) {
      return;
    }

    // Anchor the timer on the readiness signal (stable booleans) rather than the
    // live snapshot, so ongoing settling does not keep resetting it. By the time
    // it fires the live snapshot has stabilized; we then read its latest value.
    const promotionTimer = setTimeout(() => {
      setPlanningDirtyBaseline({
        isResolved: true,
        projectId: activeProjectIdRef.current,
        snapshot: currentPlanningSnapshotRef.current,
      });
      setShouldPromoteLiveDirtyBaseline(false);
    }, BASELINE_PROMOTION_DELAY_MS);

    return () => clearTimeout(promotionTimer);
  }, [
    activeProjectId,
    hasLivePlanningInputs,
    isDirtyComparisonReady,
    shouldPromoteLiveDirtyBaseline,
  ]);

  const markProjectMapSnapshotSaved = useCallback(
    (
      savedProjectId: string,
      savedPlanningSnapshot: string,
      financeState: FinanceStateSnapshot | null,
    ) => {
      const previousProjectId = activeProjectIdRef.current;
      promotePlanningDraftScopeOnCreate({
        previousProjectId,
        savedProjectId,
        fromScopeKey: buildPlanningDraftScopeKey(previousProjectId),
      });
      activeProjectIdRef.current = savedProjectId;
      updatePlanningDraft(buildPlanningDraftScopeKey(savedProjectId), {
        financeState,
        mapSnapshot: currentMapSnapshot,
        propertyContext: currentPropertyContext,
      });
      promoteSavedPlanningDirtyBaseline(savedProjectId, savedPlanningSnapshot, financeState);
      setMapSession((prev) => ({ ...prev, projectId: savedProjectId }));
    },
    [currentMapSnapshot, currentPropertyContext, promoteSavedPlanningDirtyBaseline],
  );

  const handleConfirmedMapExit = useCallback(() => {
    clearPlanningDraft(planningDraftScopeKey, 'map-exit-confirmed');
    handleMapExitLeave();
  }, [handleMapExitLeave, planningDraftScopeKey]);

  const commitStandalonePropertySelection = useCallback(
    (location: MapLocation, existingMapSearchId?: string) => {
      const nextMapSearchId = existingMapSearchId || createMapSearchId();
      clearPlanningDraft(planningDraftScopeKey, 'map-switch-property');
      detachChatSession();
      setMapSession((prev) => ({ ...prev, projectId: null, mapSearchId: nextMapSearchId }));
      commitMapUrl(buildStandaloneMapUrl(location, nextMapSearchId));
      return nextMapSearchId;
    },
    [commitMapUrl, detachChatSession, planningDraftScopeKey],
  );

  const getAuthToken = useCallback(async () => {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    return session?.access_token;
  }, []);

  const fetchStoredFinanceState = useCallback(
    async (token: string): Promise<FinanceStateSnapshot | null> => {
      if (!activeProjectId) {
        return null;
      }

      const response = await fetch(`${API_URL}/projects/${activeProjectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Project load failed with status ${response.status}`);
      }

      const project = (await response.json()) as { finance_state?: FinanceStateSnapshot | null };
      return project.finance_state ?? null;
    },
    [activeProjectId],
  );

  const resolveFinanceStateForSave = useCallback(
    async (token: string): Promise<FinanceStateSnapshot | null> => {
      const storedPlanningDraft = readPlanningDraft(planningDraftScopeKey);
      if (storedPlanningDraft?.financeState) {
        return storedPlanningDraft.financeState;
      }

      if (workingPlanningFinanceState) {
        return workingPlanningFinanceState;
      }

      return fetchStoredFinanceState(token);
    },
    [fetchStoredFinanceState, planningDraftScopeKey, workingPlanningFinanceState],
  );

  const saveDraftProjectForChat = useCallback(
    async (
      planChatContext?: PlanChatContext,
    ): Promise<{ financeState: FinanceStateSnapshot; projectId: string } | undefined> => {
      if (!result || !currentMapSnapshot) {
        throw new Error('Map state is not ready to save.');
      }

      const token = await getAuthToken();
      if (!token) {
        throw new Error('Authentication is required to save this project.');
      }

      // Autosave and the header Save button don't pass a planChatContext; fall
      // back to the live property context so yard zone, clearances, and fire
      // hazard are persisted instead of PATCHed to null.
      const mergedPlanChatContext = mergeStoredFireHazardContext(
        planChatContext ?? planChatContextFromPropertyContext(currentPropertyContext),
        launchContext,
      );
      const financeState = await calculateMapFinanceState({
        apiBaseUrl: API_URL,
        token,
        result,
        selectedLocation,
        aduSize,
        aduType,
        financeState: await resolveFinanceStateForSave(token),
        planChatContext: mergedPlanChatContext,
      });
      const savedProjectId = await persistDraftProject({
        activeProjectId: activeProjectIdRef.current,
        apiBaseUrl: API_URL,
        token,
        payload: buildDraftProjectPayload({
          result,
          selectedLocation,
          aduSize,
          aduBboxDimensions,
          aduShapeType,
          aduType,
          financeState,
          mapSnapshot: currentMapSnapshot,
          planChatContext: mergedPlanChatContext,
        }),
      });

      markProjectMapSnapshotSaved(
        savedProjectId,
        buildPlanningSessionDirtySnapshot({
          financeState,
          mapSnapshot: currentMapSnapshot,
          propertyContext: currentPropertyContext,
        }),
        financeState,
      );
      return { financeState, projectId: savedProjectId };
    },
    [
      aduBboxDimensions,
      aduShapeType,
      aduSize,
      aduType,
      currentMapSnapshot,
      getAuthToken,
      launchContext,
      markProjectMapSnapshotSaved,
      currentPropertyContext,
      resolveFinanceStateForSave,
      result,
      selectedLocation,
    ],
  );

  const saveCurrentProject = useCallback(
    async (
      planChatContext?: PlanChatContext,
      syncUrlAfterSave = false,
    ): Promise<{ financeState: FinanceStateSnapshot; projectId: string } | undefined> => {
      if (
        !result ||
        !currentMapSnapshot ||
        hasInvalidPlacement ||
        isProjectActionPendingRef.current
      ) {
        return undefined;
      }

      isProjectActionPendingRef.current = true;
      setIsProjectActionPending(true);

      try {
        const saveResult = await saveDraftProjectForChat(planChatContext);

        if (saveResult?.projectId && syncUrlAfterSave) {
          syncMapProjectIdInUrl(saveResult.projectId);
        }

        return saveResult;
      } finally {
        isProjectActionPendingRef.current = false;
        setIsProjectActionPending(false);
      }
    },
    [
      currentMapSnapshot,
      hasInvalidPlacement,
      result,
      saveDraftProjectForChat,
      syncMapProjectIdInUrl,
    ],
  );
  const handleAutosaveProject = useCallback(async (): Promise<AutosaveResult> => {
    if (hasInvalidPlacement) {
      return { status: 'blocked_invalid' };
    }

    if (!isMapSessionDirty) {
      if (!activeProjectId) {
        return { status: 'cannot_save' };
      }
      return {
        status: 'saved',
        projectId: activeProjectId,
        scopeKey: buildPlanningDraftScopeKey(activeProjectId),
      };
    }

    if (!isLoggedIn || !result || !currentMapSnapshot) {
      return { status: 'cannot_save' };
    }

    const saveResult = await saveCurrentProject();
    if (!saveResult) {
      return { status: 'cannot_save' };
    }

    return {
      status: 'saved',
      projectId: saveResult.projectId,
      scopeKey: buildPlanningDraftScopeKey(saveResult.projectId),
    };
  }, [
    activeProjectId,
    currentMapSnapshot,
    hasInvalidPlacement,
    isLoggedIn,
    isMapSessionDirty,
    result,
    saveCurrentProject,
  ]);
  const handleStartNewProject = useCallback(() => {
    const run = () => {
      startStandaloneSession();
    };

    if (!isMapSessionDirty) {
      run();
      return;
    }

    void (async () => {
      const autosaveResult = await handleAutosaveProject();
      if (autosaveResult.status === 'blocked_invalid') {
        guardInvalidPlacementAction(() => {
          clearPlanningDraft(planningDraftScopeKey, 'map-start-new-project-invalid-placement');
          run();
        });
        return;
      }
      if (autosaveResult.status !== 'saved' || !autosaveResult.scopeKey) {
        guardAction(run);
        return;
      }

      clearPlanningDraft(autosaveResult.scopeKey, 'map-start-new-project');
      run();
    })();
  }, [
    guardAction,
    guardInvalidPlacementAction,
    handleAutosaveProject,
    isMapSessionDirty,
    planningDraftScopeKey,
    startStandaloneSession,
  ]);
  const selectStandaloneProperty = useCallback(
    (location: MapLocation, options?: AddressSelectionOptions) => {
      const run = () => {
        startStandaloneSession(location, options);
      };

      if (!isMapSessionDirty) {
        run();
        return;
      }

      void (async () => {
        const autosaveResult = await handleAutosaveProject();
        if (autosaveResult.status === 'blocked_invalid') {
          guardInvalidPlacementAction(() => {
            clearPlanningDraft(planningDraftScopeKey, 'map-switch-property-invalid-placement');
            run();
          });
          return;
        }
        if (autosaveResult.status !== 'saved' || !autosaveResult.scopeKey) {
          guardAction(run);
          return;
        }

        clearPlanningDraft(autosaveResult.scopeKey, 'map-switch-property');
        run();
      })();
    },
    [
      guardAction,
      guardInvalidPlacementAction,
      handleAutosaveProject,
      isMapSessionDirty,
      planningDraftScopeKey,
      startStandaloneSession,
    ],
  );
  const handlePrimaryActionClick = useCallback(
    async (planChatContext?: PlanChatContext) => {
      if (!result || hasInvalidPlacement) {
        return;
      }

      try {
        const saveResult = await saveCurrentProject(planChatContext);
        if (!saveResult) {
          return;
        }

        const nextUrl = buildPlanChatUrl({
          activeProjectId: saveResult.projectId,
          aduBboxDimensions,
          aduShapeType,
          aduSize,
          aduType,
          isChatSession,
          planChatContext: mergeStoredFireHazardContext(planChatContext, launchContext),
          result,
          selectedLocation,
        });

        router.push(nextUrl);
      } catch (error) {
        console.error('Draft project save failed:', error);
        setError('We could not save your planning draft right now. Please try again.');
      }
    },
    [
      aduBboxDimensions,
      aduShapeType,
      aduSize,
      aduType,
      hasInvalidPlacement,
      isChatSession,
      launchContext,
      result,
      router,
      saveCurrentProject,
      selectedLocation,
      setError,
    ],
  );
  const handleMapProjectActionClick = useCallback(async () => {
    const canExitSavedProject = Boolean(activeProjectId) && !isMapSessionDirty;
    if (canExitSavedProject) {
      clearPlanningDraft(planningDraftScopeKey, 'map-header-exit');
      // Real navigation, not commitMapUrl: commitMapUrl only rewrites the
      // address bar (replaceState) to stay on /map without remounting. Exit
      // must actually leave the map, so route to /projects. Replace (not push)
      // matches the guard's own exit fallback so back doesn't re-enter the map.
      router.replace(PROJECTS_PATH);
      return;
    }

    await saveCurrentProject(undefined, true);
  }, [activeProjectId, isMapSessionDirty, planningDraftScopeKey, router, saveCurrentProject]);

  const canExitSavedProject = Boolean(activeProjectId) && !isMapSessionDirty;
  const canSaveProject = Boolean(result && currentMapSnapshot) && !hasInvalidPlacement;
  const mapProjectActionLabel = isProjectActionPending
    ? 'Saving Project…'
    : canExitSavedProject
      ? 'Exit'
      : 'Save Project';
  const isMapProjectActionDisabled =
    isProjectActionPending || (!canExitSavedProject && !canSaveProject);

  useEffect(() => {
    // After the initial launch setup, ignore incidental launchContext changes for the
    // project we're already on. An in-session save triggers a guard-cleanup history
    // navigation that mutates the URL (and can strip projectId/mapSearchId), which
    // re-fires this effect with a stale routeProjectId. Re-initing then would reset the
    // dirty baseline to an empty/undefined-project baseline that permanently mismatches
    // activeProjectId, pinning the header button to "Exit". Only re-init for a genuine
    // launch: first mount, a switch to a different project, or a cleared session.
    if (
      hasInitializedLaunchRef.current &&
      activeProjectIdRef.current &&
      (!projectId || projectId === activeProjectIdRef.current)
    ) {
      return;
    }
    hasInitializedLaunchRef.current = true;
    setMapSession((prev) =>
      createMapSessionState({
        initialAddress: restoredInitialAddress,
        isFromChat,
        projectId: projectId ?? prev.projectId,
        mapSearchId,
      }),
    );
    setPlanningDirtyBaseline(createPlanningDirtyBaseline(projectId));
    setWorkingPlanningFinanceState(readProjectPlanningDraft(projectId)?.financeState ?? null);
    setIsDirtyComparisonReady(!projectId);
    setShouldPromoteLiveDirtyBaseline(false);
  }, [isFromChat, mapSearchId, projectId, restoredInitialAddress]);

  useEffect(() => {
    if (!selectedLocation?.name) {
      return;
    }

    setSearchValue(selectedLocation.name);
  }, [selectedLocation?.name]);

  return {
    activeProjectId,
    bypassGuard,
    commitMapUrl,
    detachChatSession,
    handleAddressResult,
    handleConfirmedMapExit,
    handleDirtyComparisonReadyChange,
    handleMapProjectActionClick,
    mapExitModalMode,
    handlePrimaryActionClick,
    handlePlanningDirtyBaselineResolved,
    handleReset,
    handleStartNewProject,
    handleMapExitStay,
    handleLookupFailureCleanup,
    isChatSession,
    isMapExitModalOpen,
    isMapProjectActionDisabled,
    isMapSessionDirty,
    isPrimaryActionPending: isProjectActionPending,
    isProjectActionPending,
    mapSession,
    mapSearchId: mapSession.mapSearchId,
    mapProjectActionLabel,
    planningDraftScopeKey,
    primaryActionLabel: isChatSession ? 'Return to chat' : 'Plan your ADU',
    resumeAddress,
    searchValue,
    commitStandalonePropertySelection,
    selectStandaloneProperty,
    setSearchValue,
    startStandaloneSession,
  };
}
