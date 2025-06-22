import { Alert, Platform } from 'react-native';

const handleException = (ex) => {
  const NfcManager = require('react-native-nfc-manager').default;
  const NfcError = require('react-native-nfc-manager').NfcError;

  if (ex instanceof NfcError.UserCancel) {
    // bypass
  } else if (ex instanceof NfcError.Timeout) {
    Alert.alert('NFC Session Timeout');
  } else {
    if (Platform.OS === 'ios') {
      NfcManager.invalidateSessionWithErrorIOS(`${ex}`);
    } else {
      Alert.alert('NFC Error', `${ex}`);
    }
  }
};

export async function write(value) {
  let result = false;

  try {
    // Lazy load the NFC Manager and related components
    const NfcManager = require('react-native-nfc-manager').default;
    const NfcTech = require('react-native-nfc-manager').NfcTech;
    const Ndef = require('react-native-nfc-manager').Ndef;

    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Ready to write some NDEF',
    });

    let bytes = null;
    bytes = Ndef.encodeMessage([Ndef.textRecord(value)]);

    if (bytes) {
      await NfcManager.ndefHandler.writeNdefMessage(bytes);

      if (Platform.OS === 'ios') {
        await NfcManager.setAlertMessageIOS('Success');
      }

      result = true;
    }
  } catch (ex) {
    handleException(ex);
  } finally {
    const NfcManager = require('react-native-nfc-manager').default;
    NfcManager.cancelTechnologyRequest();
  }

  return result;
}
