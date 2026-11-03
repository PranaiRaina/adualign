'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapSnapshot } from '@/lib/planningDraft';
import {
  EMPTY_PLANNING_DIRTY_SNAPSHOT,
  buildPlanningDirtySnapshot,
} from '@/lib/planningDirtyState';
import {
  buildPlanningDraftScopeKey,
  clearPlanningDraft,
  updatePlanningDraft,
} from '@/lib/planningDraft';
import type { FinanceStateSnapshot, PropertyContext } from '@/types';

export const RESUME_CHAT_MARKER = 'SYSTEM_RESUME_CHAT';

type UseChatDraftStateArgs = {
  activeProjectId?: string;
  initialized: boolean;
  mapSnapshot: MapSnapshot | null;
  projectId?: string;
  financeState: FinanceStateSnapshot | null;
  propertyContext?: PropertyContext;
};

export function isResumeBootstrapMessage(content: string) {
  return content.startsWith(RESUME_CHAT_MARKER);
}

export function useChatDraftState({
  activeProjectId,
  financeState,
  initialized,
  mapSnapshot,
  projectId,
  propertyContext,
}: UseChatDraftStateArgs) {
  const [isDirty, setIsDirty] = useState(false);
  const hasDirtyBaselineRef = useRef(false);
  const dirtyBaselineRef = useRef(EMPTY_PLANNING_DIRTY_SNAPSHOT);
  const planningDraftScopeKey = buildPlanningDraftScopeKey(activeProjectId ?? projectId);

  const applyDirtyBaseline = useCallback((snapshot: string) => {
    dirtyBaselineRef.current = snapshot;
    hasDirtyBaselineRef.current = true;
    setIsDirty(false);
  }, []);

  const resetDirtyTracking = useCallback(() => {
    hasDirtyBaselineRef.current = false;
    dirtyBaselineRef.current = EMPTY_PLANNING_DIRTY_SNAPSHOT;
    setIsDirty(false);
  }, []);

  const clearStoredChatState = useCallback(
    (reason: string) => {
      clearPlanningDraft(planningDraftScopeKey, reason);
    },
    [planningDraftScopeKey],
  );

  useEffect(() => {
    if (!initialized || !hasDirtyBaselineRef.current) {
      return;
    }

    const nextSnapshot = buildPlanningDirtySnapshot({
      financeState,
      mapSnapshot,
      propertyContext,
    });
    const nextIsDirty = nextSnapshot !== dirtyBaselineRef.current;
    setIsDirty(nextIsDirty);

    if (!nextIsDirty) {
      return;
    }

    updatePlanningDraft(planningDraftScopeKey, {
      propertyContext: propertyContext ?? null,
      financeState,
    });
  }, [financeState, initialized, mapSnapshot, planningDraftScopeKey, propertyContext]);

  return {
    applyDirtyBaseline,
    clearStoredChatState,
    isDirty,
    resetDirtyTracking,
  };
}
