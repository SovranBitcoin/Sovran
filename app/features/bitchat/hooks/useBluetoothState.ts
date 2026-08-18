import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, type Permission } from 'react-native';
import {
  addBLEStateListener,
  getBLEState,
  openBluetoothSettings,
  requestEnableBluetooth,
} from 'bitchat-module';

/**
 * UI-facing Bluetooth readiness for the BLE mesh surfaces (Nut Drop, mesh
 * network sheet, BLE DMs). Folds the native state vocabulary
 * (poweredOn/poweredOff/unauthorized/unsupported/unknown/unavailable) into
 * what the notice UI needs, plus the actions to fix each state.
 */
type BluetoothStatus = 'ready' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'unknown';

export interface UseBluetoothStateResult {
  status: BluetoothStatus;
  /** Android: system runtime-permission dialog. iOS: no-op true (CoreBluetooth prompts on first use). */
  requestPermissions: () => Promise<boolean>;
  /** Android: system "turn on Bluetooth?" dialog. iOS: resolves false (no such affordance). */
  enableBluetooth: () => Promise<boolean>;
  /** Android: Bluetooth settings screen. iOS: the app's settings page. */
  openSettings: () => Promise<void>;
}

function mapState(state: string): BluetoothStatus {
  switch (state) {
    case 'poweredOn':
      return 'ready';
    case 'poweredOff':
      return 'poweredOff';
    case 'unauthorized':
      return 'unauthorized';
    case 'unsupported':
    case 'unavailable':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

// Mirrors BluetoothStateMonitor.requiredPermissions on the native side.
const ANDROID_PERMISSIONS: Permission[] =
  Platform.OS === 'android'
    ? Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
    : [];

export function useBluetoothState(): UseBluetoothStateResult {
  const [status, setStatus] = useState<BluetoothStatus>(() => mapState(getBLEState()));

  const refresh = useCallback(() => {
    setStatus(mapState(getBLEState()));
  }, []);

  useEffect(() => {
    const stateSub = addBLEStateListener((event) => setStatus(mapState(event.state)));
    // Covers returning from Settings / the permission dialog: the native
    // Android monitor re-derives on foreground, but iOS only reports through
    // the BLE service delegate — poll on activation for both.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    refresh();
    return () => {
      stateSub.remove();
      appStateSub.remove();
    };
  }, [refresh]);

  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    const results = await PermissionsAndroid.requestMultiple(ANDROID_PERMISSIONS);
    const granted = ANDROID_PERMISSIONS.every(
      (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED
    );
    refresh();
    return granted;
  }, [refresh]);

  const enableBluetooth = useCallback(async () => {
    const enabled = await requestEnableBluetooth();
    refresh();
    return enabled;
  }, [refresh]);

  const openSettings = useCallback(() => openBluetoothSettings(), []);

  return { status, requestPermissions, enableBluetooth, openSettings };
}
