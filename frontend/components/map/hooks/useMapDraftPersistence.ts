'use client';

import { useEffect, useMemo } from 'react';

import { readPlanningDraft, updatePlanningDraft } from '@/lib/planningDraft';
import type { AduClearance, AnalyzeResponse, PropertyContext } from '@/types';

import { buildMapSnapshot, buildPlanningDraftPropertyContext } from '../planningDraftAdapters';
import type { AduState, MapLocation, ShapeType } from '../types';
import type { AduBboxDimensions } from '../utils/aduDimensions';

interface UseMapDraftPersistenceParams {
  adu: AduState;
  aduBboxDimensions: AduBboxDimensions | null;
  aduClearances: AduClearance[];
  aduShapeType: ShapeType;
  aduSize: number;
  aduType: 'detached' | 'attached';
  currentYardZone?: string;
  disabledBuildings: Set<number>;
  frontEdgeSelectionPoint: { lng: number; lat: number } | null;
  canPersistMapDraft: boolean;
  initialPlanningContext?: PropertyContext | null;
  planningDraftScopeKey: string;
  result: AnalyzeResponse | null;
  selectedLocation: MapLocation | null;
}

export function useMapDraftPersistence({
  adu,
  aduBboxDimensions,
  aduClearances,
  aduShapeType,
  aduSize,
  aduType,
  currentYardZone,
  disabledBuildings,
  frontEdgeSelectionPoint,
  canPersistMapDraft,
  initialPlanningContext,
  planningDraftScopeKey,
  result,
  selectedLocation,
}: UseMapDraftPersistenceParams) {
  const propertyContext = useMemo(
    () =>
      buildPlanningDraftPropertyContext({
        aduBboxDimensions,
        aduClearances,
        aduShapeType,
        aduSize,
        aduType,
        currentYardZone,
        initialPlanningContext,
        result,
        selectedLocation,
      }),
    [
      aduBboxDimensions,
      aduClearances,
      aduShapeType,
      aduSize,
      aduType,
      currentYardZone,
      initialPlanningContext,
      result,
      selectedLocation,
    ],
  );
  const mapSnapshot = useMemo(
    () =>
      buildMapSnapshot({
        adu,
        aduShapeType,
        disabledBuildings,
        frontEdgeSelectionPoint,
        result,
        selectedLocation,
      }),
    [adu, aduShapeType, disabledBuildings, frontEdgeSelectionPoint, result, selectedLocation],
  );

  useEffect(() => {
    if (!canPersistMapDraft || !initialPlanningContext) {
      return;
    }

    const currentDraft = readPlanningDraft(planningDraftScopeKey);
    if (currentDraft?.mapReturnBaselineContext) {
      return;
    }

    updatePlanningDraft(planningDraftScopeKey, {
      mapReturnBaselineContext: initialPlanningContext,
    });
  }, [canPersistMapDraft, initialPlanningContext, planningDraftScopeKey]);

  useEffect(() => {
    if (!canPersistMapDraft) {
      return;
    }

    if (!propertyContext && !mapSnapshot) {
      return;
    }

    updatePlanningDraft(planningDraftScopeKey, {
      propertyContext,
      mapSnapshot,
    });
  }, [canPersistMapDraft, mapSnapshot, planningDraftScopeKey, propertyContext]);
}
