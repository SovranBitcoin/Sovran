import { Alert, Platform } from 'react-native';
import NfcManager, { NfcError, NfcTech, Ndef } from 'react-native-nfc-manager';

/**
 * Handles exceptions that may occur during NFC operations
 */
const handleException = (error: Error): void => {
  if (error instanceof NfcError.UserCancel) {
    // User canceled operation - no action needed
    return;
  }

  if (error instanceof NfcError.Timeout) {
    Alert.alert('NFC Session Timeout');
    return;
  }

  // Handle other errors based on platform
  if (Platform.OS === 'ios') {
    NfcManager.invalidateSessionWithErrorIOS(`${error}`);
  } else {
    Alert.alert('NFC Error', `${error}`);
  }
};

/**
 * Writes text data to an NFC tag
 */
export async function write(value: string): Promise<boolean> {
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Ready to write some NDEF',
    });

    const bytes = Ndef.encodeMessage([Ndef.textRecord(value)]);

    if (!bytes) {
      return false;
    }

    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    if (Platform.OS === 'ios') {
      await NfcManager.setAlertMessageIOS('Success');
    }

    return true;
  } catch (error) {
    handleException(error instanceof Error ? error : new Error(String(error)));
    return false;
  } finally {
    NfcManager.cancelTechnologyRequest();
  }
}
