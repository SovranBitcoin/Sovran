/**
 * @fileoverview Hook for managing transaction location section state and actions
 *
 * Provides a unified API for:
 * - Checking if location exists for a transaction
 * - Managing reveal state (privacy placeholder vs actual map)
 * - Attaching current location to a transaction
 * - Toggling the location stamps setting
 */

import { useState, useCallback } from 'react';
import { useSettingsStore } from 'stores/settingsStore';
import {
  useTransactionLocation,
  useTransactionLocationStore,
  TransactionLocation,
} from 'stores/transactionLocationStore';
import { getLocationForTransaction } from '@/hooks/useTransactionLocation';

export interface UseTransactionLocationSectionResult {
  /** The location data for this transaction (null if none) */
  location: TransactionLocation | null;
  /** Whether the location has been revealed by the user */
  isRevealed: boolean;
  /** Reveal the location (from privacy placeholder) */
  reveal: () => void;
  /** Hide the location (back to privacy placeholder) */
  hide: () => void;
  /** Whether location stamps are enabled globally */
  isLocationEnabled: boolean;
  /** Toggle the global location stamps setting */
  setLocationEnabled: (enabled: boolean) => void;
  /** Whether we're currently capturing location */
  isCapturing: boolean;
  /** Attach the current device location to this transaction */
  attachCurrentLocation: () => Promise<boolean>;
  /** Whether the setting was just enabled (for UI state) */
  justEnabled: boolean;
}

/**
 * Hook for managing transaction location section state
 *
 * @param transactionId - The transaction's history entry ID
 * @returns Object with location state and actions
 *
 * @example
 * ```tsx
 * function MyTransactionScreen({ transactionId }) {
 *   const {
 *     location,
 *     isRevealed,
 *     reveal,
 *     isLocationEnabled,
 *     attachCurrentLocation,
 *   } = useTransactionLocationSection(transactionId);
 *
 *   if (location && !isRevealed) {
 *     return <PrivacyPlaceholder onReveal={reveal} />;
 *   }
 *   if (location) {
 *     return <Map location={location} />;
 *   }
 *   return <EnableLocationCard onEnable={() => setLocationEnabled(true)} />;
 * }
 * ```
 */
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
      if (enabled) {
        setJustEnabled(true);
      } else {
        setJustEnabled(false);
      }
    },
    [setSendLocationEnabled]
  );

  const attachCurrentLocation = useCallback(async (): Promise<boolean> => {
    if (!transactionId) return false;

    setIsCapturing(true);
    try {
      // Temporarily enable location to get the current position
      useSettingsStore.getState().setSendLocationEnabled(true);

      const capturedLocation = await getLocationForTransaction();

      if (capturedLocation) {
        setTransactionLocation(transactionId, capturedLocation);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to capture location:', error);
      return false;
    } finally {
      setIsCapturing(false);
    }
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
