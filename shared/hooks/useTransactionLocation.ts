/**
 * @fileoverview Stateless utilities for capturing location at transaction time.
 *
 * These are plain async functions, not hooks. Call `getLocationForTransaction()`
 * at the moment of transaction creation. If location stamping is enabled and
 * permission is granted, returns coordinates. Otherwise returns null. Never throws.
 */

import * as Location from 'expo-location';

import { log } from '@/shared/lib/logger';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import {
  useTransactionLocationStore,
  type TransactionCoordinates,
} from '@/shared/stores/profile/transactionLocationStore';

/**
 * Capture current location for a transaction.
 * Call at the moment of transaction creation (not in useEffect).
 *
 * Guards: checks setting → requests permission → captures position.
 * Returns null on any failure without throwing.
 */
export async function getLocationForTransaction(): Promise<TransactionCoordinates | null> {
  try {
    // Check if location stamping is enabled
    if (!useSettingsStore.getState().sendLocationEnabled) {
      return null;
    }

    // Request/check permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    // Get current position
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch (error) {
    log.error('hooks.tx_location.get_failed', { error });
    return null;
  }
}

/**
 * Capture and store location for a transaction in one call.
 * Combines capture + store so callers don't need to coordinate both steps.
 */
export async function captureAndStoreLocation(transactionId: string): Promise<boolean> {
  const location = await getLocationForTransaction();
  if (!location) return false;

  useTransactionLocationStore.getState().setTransactionLocation(transactionId, location);
  return true;
}
