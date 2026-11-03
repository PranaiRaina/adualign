'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { FinanceStateSnapshot, PropertyContext } from '@/types';
import {
  buildPlanningDraftScopeKey,
  clearPlanningDraft,
  coerceMapSnapshot,
  type MapSnapshot,
  readPlanningDraft,
} from '@/lib/planningDraft';
import { assertOkResponse, getUserFacingErrorMessage } from '../api';
import { buildHydratedPropertyContext } from '../mappers';
import type { ChatEntryMode, ProjectChatDto, ProjectPreferences } from '../types';

function buildMapChatUrl(context: PropertyContext | undefined): string {
  if (!context?.fromMap) return '/adu-chat';

  const params = new URLSearchParams({ fromMap: '1' });
  if (context.address) params.set('address', context.address);
  if (context.county) params.set('county', context.county);
  if (context.lat !== undefined) params.set('lat', String(context.lat));
  if (context.lng !== undefined) params.set('lng', String(context.lng));
  if (context.aduType) params.set('aduType', context.aduType);
  if (context.aduSize !== undefined) params.set('aduSize', String(context.aduSize));
  if (context.aduWidthFt !== undefined) params.set('aduWidthFt', String(context.aduWidthFt));
  if (context.aduLengthFt !== undefined) params.set('aduLengthFt', String(context.aduLengthFt));
  if (context.aduShape) params.set('aduShape', context.aduShape);
  if (context.setback !== undefined) params.set('setback', String(context.setback));
  if (context.propertyArea !== undefined) params.set('propertyArea', String(context.propertyArea));
  if (context.homeSqft !== undefined) params.set('homeSqft', String(context.homeSqft));
  if (context.buildableArea !== undefined) {
    params.set('buildableArea', String(context.buildableArea));
  }
  if (context.maxAduSqft !== undefined) {
    params.set('maxAduSqft', String(context.maxAduSqft));
  }
  if (context.apn) params.set('apn', context.apn);
  if (context.fireHazardSeverity) {
    params.set('fireHazardSeverity', context.fireHazardSeverity);
  }
  if (context.fireHazardZoneType) {
    params.set('fireHazardZoneType', context.fireHazardZoneType);
  }
  if (context.currentYardZone) params.set('currentYardZone', context.currentYardZone);
  if (context.aduClearances?.length) {
    params.set('aduClearances', JSON.stringify(context.aduClearances));
  }

  return `/adu-chat?${params.toString()}`;
}

function resolveInitialPropertyContext(args: {
  entryMode: ChatEntryMode;
  propertyContextSnapshot: string;
  projectId?: string;
}): {
  financeState: FinanceStateSnapshot | null;
  propertyContext: PropertyContext | undefined;
} {
  const storedPlanningDraft = readPlanningDraft(buildPlanningDraftScopeKey(args.projectId));
  const mapReturnContext = args.propertyContextSnapshot
    ? (JSON.parse(args.propertyContextSnapshot) as PropertyContext)
    : undefined;

  if (args.entryMode === 'map-return' && mapReturnContext) {
    return {
      financeState: storedPlanningDraft?.financeState ?? null,
      propertyContext: mapReturnContext,
    };
  }

  return {
    financeState: storedPlanningDraft?.financeState ?? null,
    propertyContext: storedPlanningDraft?.propertyContext ?? mapReturnContext,
  };
}

type HydrationBaselineArgs = {
  financeState: FinanceStateSnapshot | null;
  mapSnapshot: MapSnapshot | null;
  projectPreferences: ProjectPreferences;
  propertyContext?: PropertyContext;
};

type UseChatProjectHydrationArgs = {
  activeProjectId: string | undefined;
  apiBaseUrl: string;
  applyDirtyBaseline: (snapshot: string) => void;
  buildHydrationBaselineSnapshot: (args: HydrationBaselineArgs) => string;
  defaultProjectPreferences: ProjectPreferences;
  emptyPlanningDirtySnapshot: string;
  entryMode: ChatEntryMode;
  getAuthHeaders: () => Promise<Record<string, string>>;
  initialized: boolean;
  isAuthLoading: boolean;
  isLoggedIn: boolean;
  isSaving: boolean;
  localContext: PropertyContext | undefined;
  markAutoResumed: () => void;
  projectId?: string;
  propertyContextSnapshot: string;
  queueHydrationDirtyBaseline: (args: HydrationBaselineArgs) => void;
  replaceUrl: (url: string) => void;
  resetDirtyTracking: () => void;
  setError: (message: string | null) => void;
  setActiveProjectId: Dispatch<SetStateAction<string | undefined>>;
  setFinanceState: (financeState: FinanceStateSnapshot | null) => void;
  setInitialized: Dispatch<SetStateAction<boolean>>;
  setLocalContext: Dispatch<SetStateAction<PropertyContext | undefined>>;
  setPlanningMapSnapshot: Dispatch<SetStateAction<MapSnapshot | null>>;
  setMapReturnBaselineContext: (context: PropertyContext | null) => void;
  setProjectPreferences: (preferences: ProjectPreferences) => void;
};

type UseChatProjectHydrationResult = {
  hasHydratedMapSnapshotRef: MutableRefObject<boolean>;
  hydratedMapSnapshotRef: MutableRefObject<unknown | null>;
  invalidProjectId: string | null;
  markProjectHydrated: (projectId: string) => void;
  resetHydrationState: () => void;
};

export function useChatProjectHydration({
  activeProjectId,
  apiBaseUrl,
  applyDirtyBaseline,
  buildHydrationBaselineSnapshot,
  defaultProjectPreferences,
  emptyPlanningDirtySnapshot,
  entryMode,
  getAuthHeaders,
  initialized,
  isAuthLoading,
  isLoggedIn,
  isSaving,
  localContext,
  markAutoResumed,
  projectId,
  propertyContextSnapshot,
  queueHydrationDirtyBaseline,
  replaceUrl,
  resetDirtyTracking,
  setError,
  setActiveProjectId,
  setFinanceState,
  setInitialized,
  setLocalContext,
  setPlanningMapSnapshot,
  setMapReturnBaselineContext,
  setProjectPreferences,
}: UseChatProjectHydrationArgs): UseChatProjectHydrationResult {
  const localContextRef = useRef(localContext);
  localContextRef.current = localContext;
  const hydratedProjectIdRef = useRef<string | null>(null);
  const hydratedMapSnapshotRef = useRef<unknown | null>(null);
  const hasHydratedMapSnapshotRef = useRef(false);
  const isHydratingProjectRef = useRef(false);
  const [invalidProjectId, setInvalidProjectId] = useState<string | null>(null);

  useEffect(() => {
    hydratedProjectIdRef.current = null;
    hydratedMapSnapshotRef.current = null;
    hasHydratedMapSnapshotRef.current = false;
    isHydratingProjectRef.current = false;
    setInvalidProjectId(null);
    resetDirtyTracking();
    setInitialized(false);
    setActiveProjectId(projectId);

    const initialState = resolveInitialPropertyContext({
      entryMode,
      propertyContextSnapshot,
      projectId,
    });

    setLocalContext(initialState.propertyContext);
    setPlanningMapSnapshot(
      readPlanningDraft(buildPlanningDraftScopeKey(projectId))?.mapSnapshot ?? null,
    );
    setProjectPreferences(defaultProjectPreferences);
    setFinanceState(initialState.financeState);
    setMapReturnBaselineContext(null);
  }, [
    defaultProjectPreferences,
    entryMode,
    projectId,
    propertyContextSnapshot,
    resetDirtyTracking,
    setActiveProjectId,
    setFinanceState,
    setInitialized,
    setLocalContext,
    setPlanningMapSnapshot,
    setMapReturnBaselineContext,
    setProjectPreferences,
  ]);

  useEffect(() => {
    if (isAuthLoading || initialized || activeProjectId) {
      return;
    }

    setMapReturnBaselineContext(null);
    applyDirtyBaseline(emptyPlanningDirtySnapshot);
    setInitialized(true);
  }, [
    activeProjectId,
    applyDirtyBaseline,
    emptyPlanningDirtySnapshot,
    initialized,
    isAuthLoading,
    setInitialized,
    setMapReturnBaselineContext,
  ]);

  useEffect(() => {
    if (isAuthLoading || !activeProjectId || isSaving) {
      return;
    }
    if (!isLoggedIn) {
      setInitialized(true);
      return;
    }
    if (hydratedProjectIdRef.current === activeProjectId) {
      setInitialized(true);
      return;
    }
    if (isHydratingProjectRef.current) {
      return;
    }

    let isCancelled = false;
    isHydratingProjectRef.current = true;

    const hydrateProject = async (): Promise<'hydrated' | 'invalid'> => {
      const authHeaders = await getAuthHeaders();
      const projectRes = await fetch(`${apiBaseUrl}/projects/${activeProjectId}`, {
        headers: authHeaders,
      });
      if (projectRes.status === 404) {
        clearPlanningDraft(buildPlanningDraftScopeKey(activeProjectId), 'project-not-found');
        setInvalidProjectId(activeProjectId);
        setInitialized(true);
        return 'invalid';
      }
      await assertOkResponse(projectRes, 'hydrateProject');

      const project = (await projectRes.json()) as ProjectChatDto;
      const hydratedContext = buildHydratedPropertyContext(project);
      const hydratedPreferences = {
        primaryUse: project.primary_use ?? null,
        blockerTypes: project.blocker_types ?? [],
        hasExistingStructure: null,
      };
      const hydratedFinanceState = project.finance_state ?? null;
      const storedPlanningDraft = readPlanningDraft(buildPlanningDraftScopeKey(activeProjectId));
      const resolvedMapSnapshot =
        storedPlanningDraft?.mapSnapshot ?? coerceMapSnapshot(project.map_snapshot);
      const resolvedContext =
        entryMode === 'map-return'
          ? localContextRef.current
          : (storedPlanningDraft?.propertyContext ?? hydratedContext);
      const resolvedFinanceState = storedPlanningDraft?.financeState ?? hydratedFinanceState;
      hasHydratedMapSnapshotRef.current = true;
      hydratedMapSnapshotRef.current = resolvedMapSnapshot;

      setPlanningMapSnapshot(resolvedMapSnapshot);
      setLocalContext(resolvedContext);
      setProjectPreferences(hydratedPreferences);
      setFinanceState(resolvedFinanceState);
      setMapReturnBaselineContext(
        entryMode === 'map-return'
          ? (storedPlanningDraft?.mapReturnBaselineContext ?? hydratedContext)
          : null,
      );
      queueHydrationDirtyBaseline({
        financeState: resolvedFinanceState,
        mapSnapshot: resolvedMapSnapshot,
        projectPreferences: hydratedPreferences,
        propertyContext: resolvedContext,
      });
      return 'hydrated';
    };

    hydrateProject()
      .then((status) => {
        if (isCancelled || status === 'invalid') {
          return;
        }
        hydratedProjectIdRef.current = activeProjectId;
        setInitialized(true);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        console.error('Failed to hydrate project:', error);

        const mapContext = localContextRef.current;
        if (mapContext?.fromMap) {
          markAutoResumed();
          hydratedProjectIdRef.current = null;
          setActiveProjectId(undefined);
          replaceUrl(buildMapChatUrl(mapContext));
        } else {
          markAutoResumed();
          setError(getUserFacingErrorMessage('hydrateProject', error));
        }
        setInitialized(true);
      })
      .finally(() => {
        if (!isCancelled) {
          isHydratingProjectRef.current = false;
        }
      });

    return () => {
      isCancelled = true;
      isHydratingProjectRef.current = false;
    };
  }, [
    activeProjectId,
    apiBaseUrl,
    applyDirtyBaseline,
    buildHydrationBaselineSnapshot,
    entryMode,
    getAuthHeaders,
    isAuthLoading,
    isLoggedIn,
    isSaving,
    markAutoResumed,
    replaceUrl,
    queueHydrationDirtyBaseline,
    setError,
    setActiveProjectId,
    setInitialized,
    setFinanceState,
    setLocalContext,
    setPlanningMapSnapshot,
    setMapReturnBaselineContext,
    setProjectPreferences,
  ]);

  const markProjectHydrated = useCallback((nextProjectId: string) => {
    hydratedProjectIdRef.current = nextProjectId;
  }, []);

  const resetHydrationState = useCallback(() => {
    hydratedProjectIdRef.current = null;
    setInitialized(false);
  }, [setInitialized]);

  return {
    hasHydratedMapSnapshotRef,
    hydratedMapSnapshotRef,
    invalidProjectId,
    markProjectHydrated,
    resetHydrationState,
  };
}
