/**
 * @fileoverview NFC Helper - Near Field Communication utilities for token sharing
 *
 * @module helper/nfc
 *
 * @description
 * **NFC functionality for Sovran wallet**
 * - Writes ecash tokens to NFC tags for contactless sharing
 * - Handles NFC session management and error handling
 * - Provides cross-platform NFC operations (iOS/Android)
 *
 * **Usage:**
 * ```typescript
 * import { writeTokenToNFC } from '@/helper/nfc';
 *
 * const success = await writeTokenToNFC(encodedToken);
 * if (success) {
 *   // Token successfully written to NFC
 * }
 * ```
 *
 * @see {@link app/sendToken.tsx} - Usage in send token flow
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { Alert, Platform } from 'react-native';

/**
 * Handles NFC operation exceptions with platform-specific error handling
 *
 * This function processes different types of NFC errors and provides appropriate
 * user feedback. It handles user cancellation, timeouts, and general errors
 * with platform-specific behavior for iOS and Android.
 *
 * **Process:** Check error type → Show appropriate alert → Handle iOS session invalidation
 * **Effects:** User alerts, iOS session cleanup
 *
 * @param ex - The exception/error that occurred during NFC operation
 * @returns {void}
 *
 * @example
 * try {
 *   // NFC operation
 * } catch (error) {
 *   handleNFCException(error);
 * }
 */
const handleNFCException = (ex: unknown): void => {
  const NfcManager = require('react-native-nfc-manager').default;
  const NfcError = require('react-native-nfc-manager').NfcError;

  if (ex instanceof NfcError.UserCancel) {
    // User cancelled the operation - no action needed
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

/**
 * Writes an encoded ecash token to an NFC tag for contactless sharing
 *
 * This function handles the complete NFC write process including session management,
 * NDEF message encoding, and cross-platform error handling. It allows users to
 * share ecash tokens by bringing their device close to another NFC-enabled device.
 *
 * **Process:** Request NFC technology → Encode token as NDEF → Write to tag → Cleanup session
 * **Effects:** NFC tag written, user alerts, session cleanup
 *
 * @async
 * @param {string} encodedToken - The base64 encoded ecash token to write to NFC
 * @returns {Promise<boolean>} True if write was successful, false otherwise
 * @throws {Error} When NFC technology is not available or write operation fails
 *
 * @example
 * const token = getEncodedTokenV4(sendHistoryEntry.token);
 * const success = await writeTokenToNFC(token);
 * if (success) {
 *   // Show success message to user
 *   showToast('Token shared via NFC');
 * }
 */
export async function writeTokenToNFC(encodedToken: string): Promise<boolean> {
  let writeSuccessful = false;

  try {
    // Lazy load the NFC Manager and related components
    const NfcManager = require('react-native-nfc-manager').default;
    const NfcTech = require('react-native-nfc-manager').NfcTech;
    const Ndef = require('react-native-nfc-manager').Ndef;

    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Ready to write some NDEF',
    });

    const ndefBytes = Ndef.encodeMessage([Ndef.textRecord(encodedToken)]);

    if (ndefBytes) {
      await NfcManager.ndefHandler.writeNdefMessage(ndefBytes);

      if (Platform.OS === 'ios') {
        await NfcManager.setAlertMessageIOS('Success');
      }

      writeSuccessful = true;
    }
  } catch (ex) {
    handleNFCException(ex);
  } finally {
    const NfcManager = require('react-native-nfc-manager').default;
    NfcManager.cancelTechnologyRequest();
  }

  return writeSuccessful;
}
