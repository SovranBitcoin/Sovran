/**
 * @fileoverview Stateless utilities for capturing location at transaction time.
 *
 * These are plain async functions, not hooks. Call `captureAndStoreLocation()`
 * at the moment of transaction creation. If location stamping is enabled and
 * permission is granted, it captures and stores coordinates. Never throws.
 */

import * as Location from 'expo-location';

import { log } from '@/shared/lib/logger';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import {
  useTransactionLocationStore,
  type TransactionCoordinates,
} from '@/shared/stores/profile/transactionLocationStore';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

/**
 * Capture current location for a transaction.
 * Call at the moment of transaction creation (not in useEffect).
 *
 * Guards: checks setting → requests permission → captures position.
 * Returns null on any failure without throwing.
 */
async function getLocationForTransaction(): Promise<TransactionCoordinates | null> {
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
  setTransactionAnnotation(`id:${transactionId}`, {
    location: { lat: location.latitude, lng: location.longitude },
  });
  return true;
}
