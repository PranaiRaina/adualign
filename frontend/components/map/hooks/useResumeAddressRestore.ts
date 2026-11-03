'use client';

import { useEffect, useRef } from 'react';

import { MAPBOX_TOKEN } from '../constants';
import { forwardGeocodeAddress } from '../forwardGeocodeAddress';
import type { MapLocation } from '../types';

const MAP_REOPEN_ERROR_MESSAGE =
  'We could not reopen this address on the map. Search manually to continue.';

interface UseResumeAddressRestoreParams {
  handleAddressResult: (lng: number, lat: number, placeName: string) => void;
  isChatSession: boolean;
  resumeAddress?: string;
  restoredInitialLocation?: MapLocation;
  setError: (message: string | null) => void;
  shouldWaitForBackendSnapshot: boolean;
}

export function useResumeAddressRestore({
  handleAddressResult,
  isChatSession,
  resumeAddress,
  restoredInitialLocation,
  setError,
  shouldWaitForBackendSnapshot,
}: UseResumeAddressRestoreParams) {
  const restoredAddressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resumeAddress) {
      restoredAddressRef.current = null;
      return;
    }

    if (!isChatSession || restoredInitialLocation || shouldWaitForBackendSnapshot) {
      return;
    }

    if (restoredAddressRef.current === resumeAddress) {
      return;
    }

    let isActive = true;

    const restoreAddress = async () => {
      setError(null);
      const resolvedLocation = await forwardGeocodeAddress({
        address: resumeAddress,
        accessToken: MAPBOX_TOKEN,
      });

      if (!isActive) {
        return;
      }

      restoredAddressRef.current = resumeAddress;
      if (!resolvedLocation) {
        setError(MAP_REOPEN_ERROR_MESSAGE);
        return;
      }

      handleAddressResult(resolvedLocation.lng, resolvedLocation.lat, resolvedLocation.name);
    };

    void restoreAddress();

    return () => {
      isActive = false;
    };
  }, [
    handleAddressResult,
    isChatSession,
    restoredInitialLocation,
    resumeAddress,
    setError,
    shouldWaitForBackendSnapshot,
  ]);
}
