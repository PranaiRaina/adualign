'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  buildPlanningDraftScopeKey,
  clearPlanningDraft,
  readPlanningDraft,
} from '@/lib/planningDraft';
import {
  getPlanningSessionEntryDecision,
  type PlanningSessionRouteContext,
} from '@/lib/planningSessionEntry';
import { BlockingSessionEntryModal } from './BlockingSessionEntryModal';

const BLOCKING_MODAL_TITLE = 'This planning session link is no longer valid';
const BLOCKING_MODAL_DESCRIPTION =
  'This URL does not match the active planning session in this browser tab. Leave now to avoid stale project state.';
const STALE_SESSION_EXIT_PATH = '/projects';

interface PlanningSessionEntryGateProps {
  children: ReactNode;
  routeContext: PlanningSessionRouteContext;
}

type GateStatus = 'checking' | 'allowed' | 'blocked';
const EPHEMERAL_DRAFT_SCOPE_KEY = 'ephemeral';

export function PlanningSessionEntryGate({
  children,
  routeContext,
}: PlanningSessionEntryGateProps) {
  const [gateStatus, setGateStatus] = useState<GateStatus>('checking');
  const [draftScopeToClear, setDraftScopeToClear] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Once allowed, don't re-block mid-session. History cleanup during save can
    // temporarily change search params without signalling a real navigation change.
    if (gateStatus === 'allowed') return;

    const projectDraft = routeContext.projectId
      ? readPlanningDraft(buildPlanningDraftScopeKey(routeContext.projectId))
      : null;
    const ephemeralDraft = readPlanningDraft(EPHEMERAL_DRAFT_SCOPE_KEY);
    const decision = getPlanningSessionEntryDecision({
      ephemeralDraft,
      projectDraft,
      routeContext,
    });

    setDraftScopeToClear(decision.draftScopeToClear);
    setGateStatus(decision.shouldBlock ? 'blocked' : 'allowed');
  }, [gateStatus, routeContext]);

  const handleLeave = useCallback(() => {
    if (draftScopeToClear) {
      clearPlanningDraft(draftScopeToClear, 'invalid-session-entry');
    }
    window.location.replace(STALE_SESSION_EXIT_PATH);
  }, [draftScopeToClear]);

  if (gateStatus === 'checking') {
    return null;
  }

  if (gateStatus === 'blocked') {
    return (
      <BlockingSessionEntryModal
        title={BLOCKING_MODAL_TITLE}
        description={BLOCKING_MODAL_DESCRIPTION}
        onLeave={handleLeave}
      />
    );
  }

  return <>{children}</>;
}
