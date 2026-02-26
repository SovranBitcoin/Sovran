/**
 * NFC availability checks (support and enabled state).
 */

import NfcManager from 'react-native-nfc-manager';
import { logDebug, logWarn } from './logger';

export async function isNfcSupported(): Promise<boolean> {
  try {
    const supported = await NfcManager.isSupported();
    logDebug(`NFC supported: ${supported}`);
    return supported;
  } catch (error) {
    logWarn('Failed to check NFC support:', error);
    return false;
  }
}

export async function isNfcEnabled(): Promise<boolean> {
  try {
    const enabled = await NfcManager.isEnabled();
    logDebug(`NFC enabled: ${enabled}`);
    return enabled;
  } catch (error) {
    logWarn('Failed to check if NFC is enabled:', error);
    return false;
  }
}
