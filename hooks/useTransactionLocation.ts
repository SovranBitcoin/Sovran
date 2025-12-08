/**
 * @fileoverview Simple hook for capturing location at transaction time
 *
 * Usage: Call getLocationForTransaction() at the moment of transaction creation.
 * If location stamping is enabled and permission granted, returns coordinates.
 * Otherwise returns null. Never throws.
 */

import * as Location from 'expo-location';
import { useSettingsStore } from 'stores/settingsStore';
import { useTransactionLocationStore } from 'stores/transactionLocationStore';

export interface TransactionCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Capture current location for a transaction.
 * Call this at the moment of transaction creation (not in useEffect).
 *
 * - Checks if location stamping is enabled
 * - Requests permission if needed
 * - Returns coordinates or null
 * - Never throws (logs errors)
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
    console.error('[getLocationForTransaction] Failed:', error);
    return null;
  }
}

/**
 * Capture and store location for a transaction in one call.
 * Convenience function that combines capture + store.
 *
 * @param transactionId - The history entry ID to associate location with
 * @returns true if location was stored, false otherwise
 */
export async function captureAndStoreLocation(transactionId: string): Promise<boolean> {
  const location = await getLocationForTransaction();
  if (!location) return false;

  useTransactionLocationStore.getState().setTransactionLocation(transactionId, location);
  return true;
}

/**
 * Hook to check if location stamping is enabled (for UI components)
 */
export function useLocationStampingEnabled(): boolean {
  return useSettingsStore((state) => state.sendLocationEnabled);
}

/**
 * Hook to toggle location stamping (for settings UI)
 */
export function useLocationStampingToggle() {
  const enabled = useSettingsStore((state) => state.sendLocationEnabled);
  const setEnabled = useSettingsStore((state) => state.setSendLocationEnabled);
  return { enabled, setEnabled };
}

