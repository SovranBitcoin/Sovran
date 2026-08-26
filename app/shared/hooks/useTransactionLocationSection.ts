/**
 * @fileoverview Hook for managing transaction location section state and actions.
 *
 * Composes `transactionLocationStore` selectors with settings and capture logic
 * into a single API surface for the TransactionLocationSection component.
 */

import { useState, useCallback } from 'react';

import { log } from '@/shared/lib/logger';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import {
  useTransactionLocation,
  useTransactionLocationStore,
  type TransactionCoordinates,
  type TransactionLocation,
} from '@/shared/stores/profile/transactionLocationStore';
import { getLocationForTransaction } from '@/shared/hooks/useTransactionLocation';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

async function captureLocationForTransaction(
  transactionId: string,
  setTransactionLocation: (id: string, location: TransactionCoordinates) => void,
  setIsCapturing: (capturing: boolean) => void
): Promise<boolean> {
  setIsCapturing(true);
  try {
    // Temporarily enable location to get the current position
    useSettingsStore.getState().setSendLocationEnabled(true);

    const capturedLocation = await getLocationForTransaction();

    if (capturedLocation) {
      setTransactionLocation(transactionId, capturedLocation);
      setTransactionAnnotation(`id:${transactionId}`, {
        location: { lat: capturedLocation.latitude, lng: capturedLocation.longitude },
      });
      return true;
    }
    return false;
  } catch (error) {
    log.error('hooks.tx_location.capture_failed', { error });
    return false;
  } finally {
    setIsCapturing(false);
  }
}

interface UseTransactionLocationSectionResult {
  location: TransactionLocation | null;
  isRevealed: boolean;
  reveal: () => void;
  hide: () => void;
  isLocationEnabled: boolean;
  setLocationEnabled: (enabled: boolean) => void;
  isCapturing: boolean;
  attachCurrentLocation: () => Promise<boolean>;
  justEnabled: boolean;
}

export function useTransactionLocationSection(
  transactionId: string | undefined
): UseTransactionLocationSectionResult {
  const location = useTransactionLocation(transactionId);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);

  const isLocationEnabled = useSettingsStore((state) => state.sendLocationEnabled);
  const setSendLocationEnabled = useSettingsStore((state) => state.setSendLocationEnabled);
  const setTransactionLocation = useTransactionLocationStore(
    (state) => state.setTransactionLocation
  );

  const reveal = useCallback(() => {
    setIsRevealed(true);
  }, []);

  const hide = useCallback(() => {
    setIsRevealed(false);
  }, []);

  const setLocationEnabled = useCallback(
    (enabled: boolean) => {
      setSendLocationEnabled(enabled);
      setJustEnabled(enabled);
    },
    [setSendLocationEnabled]
  );

  const attachCurrentLocation = useCallback(async (): Promise<boolean> => {
    if (!transactionId) return false;
    return captureLocationForTransaction(transactionId, setTransactionLocation, setIsCapturing);
  }, [transactionId, setTransactionLocation]);

  return {
    location,
    isRevealed,
    reveal,
    hide,
    isLocationEnabled,
    setLocationEnabled,
    isCapturing,
    attachCurrentLocation,
    justEnabled,
  };
}
