'use client';

import { useCallback, useRef, useState } from 'react';

import type { PlanChatContext } from './useMapSessionLifecycle';

interface UsePlanningAuthGateParams {
  handlePrimaryActionClick: (planChatContext?: PlanChatContext) => void;
  isAuthLoading: boolean;
  isLoggedIn: boolean;
}

export function usePlanningAuthGate({
  handlePrimaryActionClick,
  isAuthLoading,
  isLoggedIn,
}: UsePlanningAuthGateParams) {
  const [isPlanningAuthModalOpen, setIsPlanningAuthModalOpen] = useState(false);
  const pendingPlanContextRef = useRef<PlanChatContext | undefined>(undefined);

  const closePlanningAuthModal = useCallback(() => {
    setIsPlanningAuthModalOpen(false);
  }, []);

  const handlePlanClick = useCallback(
    (planChatContext?: PlanChatContext) => {
      if (isAuthLoading) {
        return;
      }

      if (!isLoggedIn) {
        pendingPlanContextRef.current = planChatContext;
        setIsPlanningAuthModalOpen(true);
        return;
      }

      handlePrimaryActionClick(planChatContext);
    },
    [handlePrimaryActionClick, isAuthLoading, isLoggedIn],
  );

  const handlePlanningAuthSuccess = useCallback(() => {
    setIsPlanningAuthModalOpen(false);
    handlePrimaryActionClick(pendingPlanContextRef.current);
    pendingPlanContextRef.current = undefined;
  }, [handlePrimaryActionClick]);

  return {
    closePlanningAuthModal,
    handlePlanClick,
    handlePlanningAuthSuccess,
    isPlanningAuthModalOpen,
  };
}
