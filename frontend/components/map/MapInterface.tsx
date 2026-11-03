'use client';

/**
 * MapInterface — Full-screen Mapbox satellite view with automated
 * ADU feasibility analysis. User searches an address, clicks "Analyze",
 * and the backend returns property boundary, obstacles, and buildable zone.
 */

import { useRef, useCallback, useMemo, useEffect, useReducer, useState } from 'react';
import Map from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import type { GeoJSONFeature, Map as MapboxMap } from 'mapbox-gl';

import ValidationHUD from './ValidationHUD';
import AddressSearch from './AddressSearch';
import MapLayers from './MapLayers';
import AduOverlaySvg from './AduOverlaySvg';
import AduControlPanel from './AduControlPanel';
import AdvisoryChip from './AdvisoryChip';
import { buildAdvisoryWarnings } from './advisoryWarnings';
import EdgeSelectOverlay from './EdgeSelectOverlay';
import MapProjectHeader from './MapProjectHeader';
import ViolationBanner from './ViolationBanner';
import { UnsavedChangesModal } from '@/components/UnsavedChangesModal';
import { BlockingSessionEntryModal } from '@/components/BlockingSessionEntryModal';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  buildPlanningDraftScopeKey,
  type MapSnapshot,
  readPlanningDraft,
} from '@/lib/planningDraft';
import { aduReducer } from './aduReducer';
import { useAttachedSnap } from './hooks/useAttachedSnap';
import { useYardZones } from './hooks/useYardZones';
import { useBuildingExclusions } from './hooks/useBuildingExclusions';
import { useAduValidation } from './hooks/useAduValidation';
import { useAutoCorrect } from './hooks/useAutoCorrect';
import { useAnalysis } from './hooks/useAnalysis';
import { useAduInteraction } from './hooks/useAduInteraction';
import { useBackendSnapshotRestore } from './hooks/useBackendSnapshotRestore';
import { useMapLayers } from './hooks/useMapLayers';
import { useMapInterfaceController } from './hooks/useMapInterfaceController';
import { useMapSessionLifecycle, type PlanChatContext } from './hooks/useMapSessionLifecycle';
import { useAduControlPanelActions } from './hooks/useAduControlPanelActions';
import { useAduClearanceGuides } from './hooks/useAduClearanceGuides';
import { useMapDraftPersistence } from './hooks/useMapDraftPersistence';
import { useResumeAddressRestore } from './hooks/useResumeAddressRestore';
import { buildMapSnapshot, buildPlanningDraftPropertyContext } from './planningDraftAdapters';
import { buildWallLengthLabels } from './utils/wallLengths';
import {
  ACTIVE_BUILDING_LAYER_IDS,
  ADU_LAYER_ID,
  BUILDING_LAYER_IDS,
  classifyMapFeatureTarget,
  isBuildingLayerFeature,
} from './mapInteractionLayers';

import 'mapbox-gl/dist/mapbox-gl.css';

/* ------------------------------------------------------------------ */
/*  Constants & Types                                                  */
/* ------------------------------------------------------------------ */

import {
  MAPBOX_TOKEN,
  IRVINE_CENTER,
  ADU_MAX_ALLOWED_AREA_SQFT,
  DEFAULT_INITIAL_ZOOM,
  MAX_MAP_ZOOM,
} from './constants';

import type {
  AduAction,
  AduState,
  MapLaunchContext,
  RectangleShapeState,
  ShapeStateCache,
} from './types';

import { generateAduPolygon } from './utils/geometry';
import { getAduBboxDimensions, getAduBboxDimensionValues } from './utils/aduDimensions';
import type { PropertyContext } from '@/types';
import { useProjectStatus } from '@/lib/hooks/useProjectStatus';
import { ProjectStatusBadge } from '@/components/ProjectStatusBadge';
import { useBudget } from '@/lib/context/UsageBudgetContext';
import {
  buildInitialAduState,
  buildInitialLocationFromMapSnapshot,
  getInitialMapAduShapeType,
  resolveInitialPlanningContext,
} from './mapSessionBootstrap';
import { reverseGeocodeMapClick } from './reverseGeocodeMapClick';

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

interface MapInterfaceProps {
  launchContext: MapLaunchContext;
}

const MAP_EXIT_MODAL_TITLE = 'Leave map without saving?';
const MAP_EXIT_MODAL_DESCRIPTION =
  'This map session will be closed and your unsaved planning changes will be lost.';
const MAP_EXIT_MODAL_CONFIRM_LABEL = 'Leave anyway';
const INVALID_PLACEMENT_EXIT_MODAL_TITLE = 'Invalid placement cannot be saved';
const INVALID_PLACEMENT_EXIT_MODAL_DESCRIPTION =
  'This ADU placement is invalid, so leaving now will discard it instead of saving it.';
const INVALID_PROJECT_MODAL_TITLE = 'This project is no longer available';
const INVALID_PROJECT_MODAL_DESCRIPTION =
  'This project no longer exists or is no longer available. Leave now to avoid stale project state.';

function setMapInteractionLock(map: MapboxMap, isLocked: boolean) {
  if (isLocked) {
    map.boxZoom.disable();
    map.doubleClickZoom.disable();
    map.dragPan.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.scrollZoom.disable();
    map.touchZoomRotate.disable();
    return;
  }

  map.boxZoom.enable();
  map.doubleClickZoom.enable();
  map.dragPan.enable();
  map.dragRotate.enable();
  map.keyboard.enable();
  map.scrollZoom.enable();
  map.touchZoomRotate.enable();
}

export default function MapInterface({ launchContext }: MapInterfaceProps) {
  const { initialLocation, initialAddress, initialPlanningContext, projectId } = launchContext;
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const usageBudget = useBudget();
  const handleAnalyzeAuthRequired = useCallback(() => {}, []);
  const initialPlanningDraft = useMemo(
    () => readPlanningDraft(buildPlanningDraftScopeKey(projectId)),
    [projectId],
  );
  const initialDraftPropertyContext = initialPlanningDraft?.propertyContext ?? null;
  const initialDraftMapSnapshot = initialPlanningDraft?.mapSnapshot ?? null;
  const resolvedInitialPlanningContext = useMemo(
    () =>
      resolveInitialPlanningContext(
        initialPlanningContext,
        initialDraftPropertyContext,
        initialDraftMapSnapshot,
      ),
    [initialDraftMapSnapshot, initialDraftPropertyContext, initialPlanningContext],
  );
  const restoredInitialLocation = useMemo(() => {
    if (initialLocation) {
      return initialLocation;
    }

    const snapshotLocation = buildInitialLocationFromMapSnapshot(initialDraftMapSnapshot);
    if (snapshotLocation) {
      return snapshotLocation;
    }

    if (
      resolvedInitialPlanningContext?.lat === undefined ||
      resolvedInitialPlanningContext?.lng === undefined
    ) {
      return undefined;
    }

    return {
      lat: resolvedInitialPlanningContext.lat,
      lng: resolvedInitialPlanningContext.lng,
      name: resolvedInitialPlanningContext.address ?? 'Selected Location',
    };
  }, [initialDraftMapSnapshot, initialLocation, resolvedInitialPlanningContext]);
  const restoredInitialAddress =
    initialAddress ??
    resolvedInitialPlanningContext?.address ??
    initialDraftMapSnapshot?.parcelContext.address ??
    initialDraftMapSnapshot?.selectedLocation.name;

  // Interactive ADU state
  const [adu, dispatch] = useReducer(
    aduReducer,
    {
      context: resolvedInitialPlanningContext,
      mapSnapshot: initialDraftMapSnapshot,
    },
    ({
      context,
      mapSnapshot,
    }: {
      context: PropertyContext | undefined;
      mapSnapshot: MapSnapshot | null;
    }) => buildInitialAduState(context, mapSnapshot),
  );
  const {
    center: aduCenter,
    size: aduSize,
    aspectRatio: aduAspectRatio,
    rotation: aduRotation,
    type: aduType,
    isValid: isAduValid,
    isAttachedSnapPending,
    isAutoCorrecting,
    legDimensions,
  } = adu;

  // Stable refs kept at MapInterface level
  const mapRef = useRef<MapRef | null>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const aduCenterRef = useRef<{ lng: number; lat: number } | null>(null);
  const attachedReachabilityRef = useRef<{
    boundary: GeoJSON.Feature<GeoJSON.Geometry> | null;
    reachableSecondaryIndices: number[];
  } | null>(null);
  const shapeStatesRef = useRef<ShapeStateCache>({
    rectangle: null,
    'l-shape': null,
    't-shape': null,
    'u-shape': null,
  });
  const initialRectangleStateRef = useRef<RectangleShapeState | null>(null);

  useEffect(() => {
    aduCenterRef.current = adu.center;
  }, [adu.center]);

  const dispatchCenter = useCallback((center: { lng: number; lat: number } | null) => {
    const action: AduAction = { type: 'SET_CENTER', center };
    dispatch(action);
  }, []);

  const { analysisState, uiState, actions } = useMapInterfaceController({
    initialLocation: restoredInitialLocation,
    mapRef,
    shapeStatesRef,
    initialRectangleStateRef,
    dispatch,
    dispatchCenter,
    initialAduShapeType:
      initialDraftMapSnapshot?.adu.shapeType ??
      getInitialMapAduShapeType(resolvedInitialPlanningContext),
  });
  const {
    selectedLocation,
    selectedLocationOrigin,
    isLoading,
    result,
    error,
    setIsLoading,
    setResult,
    setError,
    autoAnalyzePending,
    setAutoAnalyzePending,
  } = analysisState;
  const [showWallLengths, setShowWallLengths] = useState(false);
  const wallLengthLabelData = useMemo(
    () => buildWallLengthLabels((result?.detected_buildings?.[0] as GeoJSON.Geometry) ?? null, 8),
    [result?.detected_buildings],
  );
  const {
    uiVisible,
    edgeSelectMode,
    yardZones,
    showYardLabels,
    aduShapeType,
    autoEdgeAlign,
    autoPositionCorrection,
    showAdvancedSettings,
    hoveredBuildingIndex,
    attachedReachableSecondaryIndices,
    setUiVisible,
    setEdgeSelectMode,
    setYardZones,
    setShowYardLabels,
    setAduShapeType,
    setAutoEdgeAlign,
    setAutoPositionCorrection,
    setShowAdvancedSettings,
    setHoveredBuildingIndex,
    setAttachedReachableSecondaryIndices,
  } = uiState;
  const { handleAddressResult: selectLocationFromAddress, handleReset: resetMapSession } = actions;
  const currentLegDimensions =
    aduShapeType !== 'rectangle' ? legDimensions[aduShapeType] : undefined;
  const attachedReachableSecondaryIndexSet = useMemo(
    () => new Set(attachedReachableSecondaryIndices),
    [attachedReachableSecondaryIndices],
  );

  const {
    disabledBuildings,
    toggleBuilding,
    restoreDisabledBuildings,
    onBuildingClick,
    onBuildingEnter,
    onBuildingLeave,
    resetDisabledBuildings,
  } = useBuildingExclusions({
    result,
    setResult,
    aduType,
    attachedReachabilityRef,
    attachedReachableSecondaryIndices,
    attachedReachableSecondaryIndexSet,
    initialDisabledBuildingIndices: initialDraftMapSnapshot?.disabledBuildingIndices,
    mapRef,
    setHoveredBuildingIndex,
  });
  const {
    propertySourceData,
    activeUnbuildableSourceData,
    activeBuildableFeature,
    activeBuildableSourceData,
    movementBoundary,
    attachedDragBounds,
    visibleSecondaryBuildingIndices,
    activeBuildingExclusionsData,
    disabledBuildingExclusionsData,
    hoveredBuildingData,
  } = useMapLayers({
    result,
    aduType,
    disabledBuildings,
    attachedReachabilityRef,
    attachedReachableSecondaryIndices,
    setAttachedReachableSecondaryIndices,
    hoveredBuildingIndex,
    setHoveredBuildingIndex,
  });
  const canPersistMapDraft = Boolean(result);

  const aduPolygon = useMemo(() => {
    if (!aduCenter) return null;
    return generateAduPolygon(
      aduCenter,
      aduSize,
      aduAspectRatio,
      aduRotation,
      aduShapeType,
      currentLegDimensions,
    );
  }, [aduCenter, aduSize, aduAspectRatio, aduRotation, aduShapeType, currentLegDimensions]);
  const aduBboxDimensions = useMemo(
    () => (aduPolygon ? getAduBboxDimensionValues(aduPolygon, aduRotation) : null),
    [aduPolygon, aduRotation],
  );
  const { clearanceGuideSourceData, aduClearances } = useAduClearanceGuides({
    aduPolygon,
    aduRotation,
    result,
    disabledBuildings,
    aduType,
    isAduValid,
    attachedReachableSecondaryIndexSet,
  });
  const { stopAutoCorrectAnimation, findDetachedAutoCorrectTarget, animateAutoCorrectTo } =
    useAutoCorrect({
      aduCenterRef,
      aduType,
      result,
      aduSize,
      aduAspectRatio,
      aduRotation,
      aduShapeType,
      currentLegDimensions,
      dispatchCenter,
      dispatch,
    });
  const { snapToNearestWall, snapAttachedPlacement } = useAttachedSnap({
    result,
    disabledBuildings,
    attachedReachabilityRef,
    aduType,
    aduRotation,
    aduSize,
    aduAspectRatio,
    aduShapeType,
    legDimensions,
    aduCenterRef,
    animateAutoCorrectTo,
    dispatchCenter,
    dispatch,
  });
  const {
    isDraggingAdu,
    aduSelected,
    setAduSelected,
    interactionMode,
    selectedOverlayGeometry,
    startOverlayInteraction,
    startMapAduDrag,
    onAduEnter,
    onAduLeave,
    isAduInteracting,
    suppressNextMapClickRef,
  } = useAduInteraction({
    aduCenter,
    aduCenterRef,
    aduSize,
    aduAspectRatio,
    aduRotation,
    aduShapeType,
    aduType,
    aduPolygon,
    currentLegDimensions,
    legDimensions,
    result,
    movementBoundary,
    attachedDragBounds,
    autoEdgeAlign,
    autoPositionCorrection,
    isAutoCorrecting,
    isAttachedSnapPending,
    edgeSelectMode,
    mapRef,
    overlaySvgRef,
    dispatchCenter,
    dispatch,
    snapAttachedPlacement,
    findDetachedAutoCorrectTarget,
    animateAutoCorrectTo,
    stopAutoCorrectAnimation,
  });

  const panelActions = useAduControlPanelActions({
    aduType,
    aduCenter,
    aduSize,
    aduAspectRatio,
    aduRotation,
    aduShapeType,
    currentLegDimensions,
    movementBoundary,
    aduMaxArea: result?.max_adu_sqft || ADU_MAX_ALLOWED_AREA_SQFT,
    shapeStatesRef,
    initialRectangleStateRef,
    dispatch,
    dispatchCenter,
    snapToNearestWall,
    snapAttachedPlacement,
    setAduShapeType,
    autoEdgeAlign,
    setAutoEdgeAlign,
    autoPositionCorrection,
    setAutoPositionCorrection,
    showAdvancedSettings,
    setShowAdvancedSettings,
  });
  /* ---------------------------------------------------------------- */
  /*  ADU Math & Validation                                           */
  /* ---------------------------------------------------------------- */

  const {
    propertyEdges,
    handleEdgeSelect,
    reopenFrontEdgeSelection,
    restoreFrontEdgeSelectionPoint,
    skipFrontEdgeSelection,
    internalYardLines,
    yardLabelPositions,
    currentZone,
    selectedFrontEdgePoint,
  } = useYardZones({
    result,
    edgeSelectMode,
    setEdgeSelectMode,
    aduPolygon,
    yardZones,
    setYardZones,
    setShowYardLabels,
  });
  const currentMapSnapshot = useMemo(
    () =>
      buildMapSnapshot({
        adu,
        aduShapeType,
        disabledBuildings,
        frontEdgeSelectionPoint: selectedFrontEdgePoint,
        result,
        selectedLocation,
      }),
    [adu, aduShapeType, disabledBuildings, result, selectedFrontEdgePoint, selectedLocation],
  );
  const currentPropertyContext = useMemo(
    () =>
      buildPlanningDraftPropertyContext({
        aduBboxDimensions,
        aduClearances,
        aduShapeType,
        aduSize,
        aduType,
        currentYardZone: currentZone,
        initialPlanningContext: resolvedInitialPlanningContext,
        result,
        selectedLocation,
      }),
    [
      aduBboxDimensions,
      aduClearances,
      aduShapeType,
      aduSize,
      aduType,
      currentZone,
      resolvedInitialPlanningContext,
      result,
      selectedLocation,
    ],
  );
  const { invalidReasons } = useAduValidation({
    aduPolygon,
    result,
    disabledBuildings,
    aduType,
    isDraggingAdu,
    isAttachedSnapPending,
    isAutoCorrecting,
    attachedReachableSecondaryIndices,
    attachedReachabilityRef,
    dispatch,
  });
  const hasInvalidPlacement = invalidReasons.length > 0;
  const {
    activeProjectId,
    bypassGuard,
    commitStandalonePropertySelection,
    handleAddressResult,
    handleConfirmedMapExit,
    handleDirtyComparisonReadyChange,
    handleLookupFailureCleanup,
    handleMapProjectActionClick,
    handlePlanningDirtyBaselineResolved,
    mapExitModalMode,
    handlePrimaryActionClick,
    handleStartNewProject,
    handleMapExitStay,
    isMapProjectActionDisabled,
    isChatSession,
    isMapExitModalOpen,
    isProjectActionPending,
    isPrimaryActionPending,
    mapProjectActionLabel,
    mapSearchId,
    planningDraftScopeKey,
    primaryActionLabel,
    resumeAddress,
    searchValue,
    selectStandaloneProperty,
    setSearchValue,
  } = useMapSessionLifecycle({
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
  });
  const projectStatusInfo = useProjectStatus(activeProjectId);
  const restore = useBackendSnapshotRestore({
    activeProjectId,
    edgeSelectMode,
    handleAddressResult,
    initialDraftMapSnapshot,
    isAuthLoading,
    isLoggedIn,
    onDirtyComparisonReadyChange: handleDirtyComparisonReadyChange,
    onPlanningDirtyBaselineResolved: handlePlanningDirtyBaselineResolved,
    restoreDisabledBuildings,
    restoreFrontEdgeSelectionPoint,
    result,
    selectedLocation,
  });
  const handleInvalidProjectLeave = useCallback(() => {
    window.location.replace('/projects');
  }, []);
  useResumeAddressRestore({
    handleAddressResult,
    isChatSession,
    resumeAddress,
    restoredInitialLocation,
    setError,
    shouldWaitForBackendSnapshot: restore.flags.shouldWaitForBackendSnapshot,
  });
  const { handleAnalyze, isAutoAnalysisQueued } = useAnalysis({
    selectedLocation,
    selectedLocationOrigin,
    projectId: activeProjectId,
    mapSearchId,
    onMapSearchCharged: usageBudget.refresh,
    initialLocation: restoredInitialLocation,
    shouldAutoAnalyzeInitialLocation: !restore.flags.shouldWaitForBackendSnapshot,
    autoAnalyzePending,
    setAutoAnalyzePending,
    isLoggedIn,
    isAuthLoading,
    onAuthRequired: handleAnalyzeAuthRequired,
    onLookupFailureCleanup: handleLookupFailureCleanup,
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
  });
  const isAnalysisQueuedOrResolving =
    restore.flags.shouldWaitForBackendSnapshot || isAutoAnalysisQueued;
  const isMapInteractionLocked = isLoading || isAnalysisQueuedOrResolving;
  const handlePropertyAnalyze = useCallback(() => {
    let mapSearchIdForRequest = mapSearchId;
    if (selectedLocation && !result) {
      mapSearchIdForRequest = commitStandalonePropertySelection(selectedLocation, mapSearchId);
    }
    void handleAnalyze(mapSearchIdForRequest);
  }, [commitStandalonePropertySelection, handleAnalyze, mapSearchId, result, selectedLocation]);
  const handleSearchValueChange = useCallback(
    (value: string) => {
      setSearchValue(value);
    },
    [setSearchValue],
  );
  useMapDraftPersistence({
    adu,
    aduBboxDimensions,
    aduClearances,
    aduShapeType,
    aduSize,
    aduType,
    currentYardZone: currentZone,
    disabledBuildings,
    frontEdgeSelectionPoint: selectedFrontEdgePoint,
    canPersistMapDraft,
    initialPlanningContext: resolvedInitialPlanningContext,
    planningDraftScopeKey,
    result,
    selectedLocation,
  });

  const aduMaxArea = result?.max_adu_sqft || ADU_MAX_ALLOWED_AREA_SQFT;
  const bannerVisible =
    invalidReasons.length > 0 &&
    (aduType === 'detached' || !isDraggingAdu) &&
    !edgeSelectMode &&
    uiVisible &&
    !!result &&
    !!aduCenter;

  const advisoryWarnings = buildAdvisoryWarnings({
    aduType,
    aduSize,
    homeSqft: result?.home_sqft,
    currentZone,
  });
  // Red outranks amber: the chip yields the top-center slot to ViolationBanner.
  const advisoryChipVisible =
    !bannerVisible && !edgeSelectMode && uiVisible && !!result && !!aduCenter;

  const displayAduSize = Number.isInteger(aduSize)
    ? aduSize.toString()
    : (Math.trunc(aduSize * 100) / 100).toFixed(2);
  const aduDimensions = useMemo(
    () => (aduPolygon ? getAduBboxDimensions(aduPolygon, aduRotation) : null),
    [aduPolygon, aduRotation],
  );

  const interactiveLayerIds = useMemo(() => {
    if (!activeBuildableFeature) return undefined;
    // Performance: disable costly secondary-structure hit-testing while moving/animating ADU.
    if (isAduInteracting) return [ADU_LAYER_ID];
    return [ADU_LAYER_ID, ...BUILDING_LAYER_IDS];
  }, [activeBuildableFeature, isAduInteracting]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) {
      return;
    }

    setMapInteractionLock(map, isMapInteractionLocked);

    return () => {
      setMapInteractionLock(map, false);
    };
  }, [isMapInteractionLocked]);

  const handleMapClick = useCallback(
    async (event: { lngLat: { lng: number; lat: number } }) => {
      if (isDraggingAdu || isMapInteractionLocked || result) {
        return;
      }

      const { lng, lat } = event.lngLat;
      const resolvedLocation = await reverseGeocodeMapClick({
        lng,
        lat,
        accessToken: MAPBOX_TOKEN,
      });

      selectStandaloneProperty(resolvedLocation, {
        autoAnalyze: false,
        flyTo: false,
      });
    },
    [isDraggingAdu, isMapInteractionLocked, result, selectStandaloneProperty],
  );

  if (restore.flags.isProjectInvalid) {
    return (
      <BlockingSessionEntryModal
        title={INVALID_PROJECT_MODAL_TITLE}
        description={INVALID_PROJECT_MODAL_DESCRIPTION}
        onLeave={handleInvalidProjectLeave}
      />
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          ...IRVINE_CENTER,
          zoom: DEFAULT_INITIAL_ZOOM,
          pitch: 0,
          bearing: 0,
        }}
        maxZoom={MAX_MAP_ZOOM}
        mapStyle="mapbox://styles/mapbox/satellite-v9"
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        cursor={isMapInteractionLocked ? 'wait' : 'auto'}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) {
            return;
          }
          setMapInteractionLock(map, isMapInteractionLocked);
        }}
        onDragStart={() => {
          if (isMapInteractionLocked) {
            return;
          }
          if (interactionMode === 'idle') {
            setAduSelected(false);
          }
        }}
        interactiveLayerIds={interactiveLayerIds}
        onMouseEnter={(e) => {
          if (isMapInteractionLocked || isAduInteracting) return;
          const featureTarget = classifyMapFeatureTarget(
            e.features as GeoJSONFeature[] | undefined,
          );
          if (featureTarget === 'adu') {
            // ADU always takes priority for drag interactions
            onAduEnter();
            return;
          }
          if (isBuildingLayerFeature(e.features as GeoJSONFeature[] | undefined)) {
            onBuildingEnter(e);
          }
        }}
        onMouseLeave={() => {
          if (isMapInteractionLocked || isAduInteracting) return;
          onAduLeave();
          onBuildingLeave();
        }}
        onClick={(e) => {
          if (isMapInteractionLocked) {
            return;
          }

          const featureTarget = classifyMapFeatureTarget(
            e.features as GeoJSONFeature[] | undefined,
          );
          if (suppressNextMapClickRef.current) {
            suppressNextMapClickRef.current = false;
            // Only suppress the synthetic post-drag click when it lands back on the ADU.
            // If the user clicks off-shape, allow immediate deselect in one click.
            if (featureTarget === 'adu') return;
          }
          if (isDraggingAdu) return;
          // If in edge selection mode, handle edge selection
          if (edgeSelectMode) {
            handleEdgeSelect(e);
            return;
          }
          if (featureTarget === 'adu') {
            setAduSelected(true);
            return;
          }
          if (featureTarget === 'active-building') {
            setAduSelected(false);
            onBuildingClick(e);
            return;
          }
          if (featureTarget === 'disabled-building') {
            setAduSelected(false);
            onBuildingClick(e);
            return;
          }
          // Otherwise, delegate to the normal map click
          setAduSelected(false);
          handleMapClick(e);
        }}
        onMouseDown={(event) => {
          if (isMapInteractionLocked) {
            return;
          }
          startMapAduDrag(event);
        }}
      >
        <MapLayers
          selectedLocation={selectedLocation}
          result={result}
          propertySourceData={propertySourceData}
          activeUnbuildableSourceData={activeUnbuildableSourceData}
          activeBuildableSourceData={activeBuildableSourceData}
          activeBuildingExclusionsData={activeBuildingExclusionsData}
          disabledBuildingExclusionsData={disabledBuildingExclusionsData}
          hoveredBuildingData={hoveredBuildingData}
          clearanceGuideSourceData={clearanceGuideSourceData}
          wallLengthLabelData={wallLengthLabelData}
          showWallLengths={showWallLengths}
          internalYardLines={internalYardLines}
          aduPolygon={aduPolygon}
          edgeSelectMode={edgeSelectMode}
          propertyEdges={propertyEdges}
          yardLabelPositions={yardLabelPositions}
          showYardLabels={showYardLabels}
          aduType={aduType}
          isAduValid={isAduValid}
          isAduInteracting={isAduInteracting}
          isDraggingAdu={isDraggingAdu}
          disabledBuildings={disabledBuildings}
          uiVisible={uiVisible}
          onSetUiVisible={(v) => setUiVisible(v)}
          onReselectFrontYard={reopenFrontEdgeSelection}
        />
      </Map>

      <AduOverlaySvg
        geometry={selectedOverlayGeometry}
        svgRef={overlaySvgRef}
        onMouseDown={startOverlayInteraction}
      />

      <MapProjectHeader
        actionLabel={mapProjectActionLabel}
        isActionBusy={isProjectActionPending}
        isActionDisabled={isMapProjectActionDisabled}
        onActionClick={() => {
          void handleMapProjectActionClick();
        }}
      />

      {/* Interactive ADU Control Panel */}
      {result && aduCenter && (
        <AduControlPanel
          panelState={{
            aduType,
            aduSize,
            aduRotation,
            aduShapeType,
            isAduValid,
            invalidReasons,
            isDraggingAdu,
            currentZone,
            autoEdgeAlign,
            autoPositionCorrection,
            showAdvancedSettings,
            uiVisible,
            displayAduSize,
            aduDimensions,
            aspectRatioSliderValue: panelActions.aspectRatioSliderValue,
          }}
          panelConstraints={{ aduMaxArea }}
          panelActions={panelActions}
          primaryActionLabel={primaryActionLabel}
          isPrimaryActionPending={isPrimaryActionPending}
          onPrimaryActionClick={() =>
            bypassGuard(() =>
              handlePrimaryActionClick({
                currentYardZone: currentZone,
                aduClearances,
              }),
            )
          }
        />
      )}

      <EdgeSelectOverlay visible={edgeSelectMode && !!result} onSkip={skipFrontEdgeSelection} />

      <ViolationBanner invalidReasons={invalidReasons} visible={bannerVisible} />
      <AdvisoryChip warnings={advisoryWarnings} visible={advisoryChipVisible} />

      {/* HUD Overlay */}
      <ValidationHUD
        selectedLocation={selectedLocation}
        isLoading={isLoading}
        isAnalysisQueuedOrResolving={isAnalysisQueuedOrResolving}
        result={result}
        error={error}
        onAnalyze={handlePropertyAnalyze}
        onStartNewProject={handleStartNewProject}
        disabledBuildings={disabledBuildings}
        hoveredBuildingIndex={hoveredBuildingIndex}
        onToggleBuilding={toggleBuilding}
        onHoverBuilding={(idx) => setHoveredBuildingIndex(idx)}
        visibleSecondaryBuildingIndices={visibleSecondaryBuildingIndices}
        showWallLengths={showWallLengths}
        onToggleWallLengths={() => setShowWallLengths((prev) => !prev)}
        uiVisible={uiVisible}
        isDraggingAdu={isDraggingAdu}
        projectStatusBadge={
          <ProjectStatusBadge
            workflowState={projectStatusInfo.workflowState}
            savedAddress={projectStatusInfo.address}
            currentAddress={selectedLocation?.name}
            compact
          />
        }
      />

      {/* Address Search Bar */}
      <AddressSearch
        accessToken={MAPBOX_TOKEN}
        isDisabled={isMapInteractionLocked}
        value={searchValue}
        onInvalidResult={setError}
        onValueChange={handleSearchValueChange}
        onResult={(lng, lat, placeName) => {
          if (isMapInteractionLocked) {
            return;
          }
          selectStandaloneProperty({ lng, lat, name: placeName });
        }}
      />

      <UnsavedChangesModal
        isOpen={isMapExitModalOpen}
        title={
          mapExitModalMode === 'invalid_placement'
            ? INVALID_PLACEMENT_EXIT_MODAL_TITLE
            : MAP_EXIT_MODAL_TITLE
        }
        description={
          mapExitModalMode === 'invalid_placement'
            ? INVALID_PLACEMENT_EXIT_MODAL_DESCRIPTION
            : MAP_EXIT_MODAL_DESCRIPTION
        }
        confirmLabel={MAP_EXIT_MODAL_CONFIRM_LABEL}
        onStay={handleMapExitStay}
        onLeave={handleConfirmedMapExit}
      />
    </div>
  );
}
