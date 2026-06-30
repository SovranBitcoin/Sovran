/**
 * NFC availability checks (support and enabled state).
 */

import NfcManager from 'react-native-nfc-manager';
import { nfcLog } from '../logger';

export async function isNfcSupported(): Promise<boolean> {
  try {
    const supported = await NfcManager.isSupported();
    nfcLog.debug('nfc.supported', { supported });
    return supported;
  } catch (error) {
    nfcLog.warn('nfc.support_check_failed', { error });
    return false;
  }
}

export async function isNfcEnabled(): Promise<boolean> {
  try {
    const enabled = await NfcManager.isEnabled();
    nfcLog.debug('nfc.enabled', { enabled });
    return enabled;
  } catch (error) {
    nfcLog.warn('nfc.enabled_check_failed', { error });
    return false;
  }
}
