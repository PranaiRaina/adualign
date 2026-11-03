'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceStateSnapshot, PropertyContext } from '@/types';
import { assertOkResponse, getUserFacingErrorMessage } from '../api';
import { buildFinancePayload } from '../mappers';
import type { CalculatorResponse } from '../types';

type UseCalculatorStateArgs = {
  activeProjectId?: string;
  apiBaseUrl: string;
  financeState: FinanceStateSnapshot | null;
  getProtectedAuthHeaders: () => Promise<Record<string, string>>;
  initialized: boolean;
  isAuthLoading: boolean;
  isLoggedIn: boolean;
  isSaving: boolean;
  suppressAutoRefresh?: boolean;
  localContext?: PropertyContext;
  onAutoRefreshSettled?: (financeState: FinanceStateSnapshot | null) => void;
  openPlanningAuthModal: () => void;
  setFinanceState: (financeState: FinanceStateSnapshot | null) => void;
};

type RefreshCalculatorOptions = {
  propertyContext?: PropertyContext;
};

export function useCalculatorState({
  activeProjectId,
  apiBaseUrl,
  financeState,
  getProtectedAuthHeaders,
  initialized,
  isAuthLoading,
  isLoggedIn,
  isSaving,
  suppressAutoRefresh = false,
  localContext,
  onAutoRefreshSettled,
  openPlanningAuthModal,
  setFinanceState,
}: UseCalculatorStateArgs) {
  const [calculatorPresentation, setCalculatorPresentation] = useState<
    CalculatorResponse['presentation'] | null
  >(null);
  const [isCalculatorLoading, setIsCalculatorLoading] = useState(false);
  const [calculatorError, setCalculatorError] = useState<string | null>(null);

  const financeStateRef = useRef(financeState);
  financeStateRef.current = financeState;
  const propertyContextRef = useRef(localContext);
  propertyContextRef.current = localContext;
  const aduClearancesSignature = JSON.stringify(localContext?.aduClearances ?? []);

  const applyCalculatorResponse = useCallback(
    (calculatorResponse: CalculatorResponse) => {
      setFinanceState(calculatorResponse.finance_state);
      setCalculatorPresentation(calculatorResponse.presentation);
    },
    [setFinanceState],
  );

  const fetchCalculatorData = useCallback(
    async (
      nextFinanceState: FinanceStateSnapshot | null = financeStateRef.current,
      options: RefreshCalculatorOptions = {},
    ) => {
      if (isAuthLoading) return;
      if (!isLoggedIn) {
        openPlanningAuthModal();
        return;
      }

      const authHeaders = await getProtectedAuthHeaders();
      const response = await fetch(`${apiBaseUrl}/chatbot/calculator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(
          buildFinancePayload(
            options.propertyContext ?? propertyContextRef.current,
            nextFinanceState,
            {
              projectId: activeProjectId,
              persistFinanceState: false,
            },
          ),
        ),
      });

      await assertOkResponse(response, 'refreshCalculator');
      return (await response.json()) as CalculatorResponse;
    },
    [
      activeProjectId,
      apiBaseUrl,
      getProtectedAuthHeaders,
      isAuthLoading,
      isLoggedIn,
      openPlanningAuthModal,
    ],
  );

  const refreshCalculator = useCallback(
    async (
      nextFinanceState: FinanceStateSnapshot | null = financeStateRef.current,
      options: RefreshCalculatorOptions = {},
    ) => {
      if (isAuthLoading) return;
      if (!isLoggedIn) {
        openPlanningAuthModal();
        return;
      }

      setIsCalculatorLoading(true);
      setCalculatorError(null);

      try {
        const calculatorResponse = await fetchCalculatorData(nextFinanceState, options);
        if (!calculatorResponse) {
          return;
        }

        applyCalculatorResponse(calculatorResponse);
        return calculatorResponse;
      } catch (error) {
        console.error('Failed to refresh calculator:', error);
        setCalculatorError(getUserFacingErrorMessage('refreshCalculator', error));
        throw error;
      } finally {
        setIsCalculatorLoading(false);
      }
    },
    [
      applyCalculatorResponse,
      fetchCalculatorData,
      isAuthLoading,
      isLoggedIn,
      openPlanningAuthModal,
    ],
  );

  const resetCalculatorState = useCallback(() => {
    setCalculatorPresentation(null);
    setCalculatorError(null);
    setIsCalculatorLoading(false);
  }, []);

  useEffect(() => {
    if (!initialized || isAuthLoading || !isLoggedIn || isSaving || suppressAutoRefresh) {
      return;
    }

    void refreshCalculator()
      .then((calculatorResponse) => {
        onAutoRefreshSettled?.(
          calculatorResponse?.finance_state ?? financeStateRef.current ?? null,
        );
      })
      .catch(() => {
        onAutoRefreshSettled?.(financeStateRef.current ?? null);
      });
  }, [
    initialized,
    isAuthLoading,
    isLoggedIn,
    isSaving,
    suppressAutoRefresh,
    onAutoRefreshSettled,
    refreshCalculator,
    localContext?.address,
    localContext?.county,
    localContext?.aduSize,
    localContext?.aduType,
    localContext?.fireHazardSeverity,
    localContext?.fireHazardZoneType,
    localContext?.currentYardZone,
    aduClearancesSignature,
  ]);

  return {
    calculatorError,
    calculatorPresentation,
    fetchCalculatorData,
    isCalculatorLoading,
    refreshCalculator,
    resetCalculatorState,
  };
}
