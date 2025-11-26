/**
 * @fileoverview NFC Helper - Near Field Communication utilities for token sharing
 *
 * @module helper/nfc
 *
 * @description
 * **NFC functionality for Sovran wallet**
 * - Writes ecash tokens to NFC tags for contactless sharing
 * - Reads payment requests from POS devices via NDEF
 * - Writes Cashu tokens back to POS devices
 * - Handles NFC session management and error handling
 * - Provides cross-platform NFC operations (iOS/Android)
 *
 * **Usage:**
 * ```typescript
 * import { writeTokenToNFC, readNdefFromPOS, writeCashuTokenToPOS } from '@/helper/nfc';
 *
 * const success = await writeTokenToNFC(encodedToken);
 * const paymentRequest = await readNdefFromPOS();
 * const writeSuccess = await writeCashuTokenToPOS(cashuToken);
 * ```
 *
 * @see {@link app/sendToken.tsx} - Usage in send token flow
 */

import { Alert, Platform } from 'react-native';
import NfcManager, { NfcTech, Ndef, NfcError } from 'react-native-nfc-manager';
import { decodePaymentRequest, getEncodedTokenV4 } from '@cashu/cashu-ts';

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

/**
 * Reads an NDEF message from a POS device (Android HCE)
 *
 * This function handles reading payment requests from Android POS terminals
 * that use Host Card Emulation (HCE) to emulate NDEF Type 4 tags.
 * The payment request is expected to be in NDEF Text Record format starting with "creq...".
 *
 * **Process:** Request NFC technology → Read NDEF message → Extract text payload → Cleanup session
 * **Effects:** NDEF message read, session cleanup
 *
 * @async
 * @returns {Promise<string | null>} The decoded payment request string, or null if read failed
 * @throws {Error} When NFC technology is not available or read operation fails
 *
 * @example
 * const paymentRequest = await readNdefFromPOS();
 * if (paymentRequest) {
 *   // Process payment request starting with "creq..."
 * }
 */
export async function readNdefFromPOS(): Promise<string | null> {
  let paymentRequest: string | null = null;

  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold your device near the POS terminal',
    });

    // Get the tag data
    const tag = await NfcManager.getTag();

    if (tag && tag.ndefMessage && tag.ndefMessage.length > 0) {
      // Decode the NDEF message
      // NDEF messages contain records, we need to extract text from text records
      const ndefRecords = tag.ndefMessage;

      for (const record of ndefRecords) {
        try {
          // Check if it's a text record (TNF=1, type="T")
          if (record.tnf === 1 && record.type && record.type.length > 0) {
            // Convert type array to string
            const typeArray = Array.isArray(record.type) ? record.type : [record.type];
            const typeString = String.fromCharCode(
              ...typeArray.map((v: number | string) => Number(v))
            );
            if (typeString === 'T' && record.payload) {
              // Decode text payload - payload should be Uint8Array or array of numbers
              let payloadArray: Uint8Array;
              if (record.payload instanceof Uint8Array) {
                payloadArray = record.payload;
              } else if (Array.isArray(record.payload)) {
                payloadArray = new Uint8Array(
                  record.payload.map((v: number | string) => Number(v))
                );
              } else {
                continue; // Skip if payload format is unexpected
              }
              const text = Ndef.text.decodePayload(payloadArray);
              if (text) {
                paymentRequest = text;
                break; // Use the first text record found
              }
            }
          }
        } catch (decodeError) {
          // Continue to next record if decoding fails
          console.warn('Failed to decode NDEF record:', decodeError);
        }
      }

      if (Platform.OS === 'ios' && paymentRequest) {
        await NfcManager.setAlertMessageIOS('Payment request received');
      }
    }
  } catch (ex) {
    handleNFCException(ex);
  } finally {
    NfcManager.cancelTechnologyRequest();
  }

  return paymentRequest;
}

/**
 * Writes a Cashu token to a POS device (Android HCE) via NDEF
 *
 * This function writes a Cashu token back to an Android POS terminal
 * that is using Host Card Emulation (HCE) to receive payment tokens.
 * The token is written as an NDEF Text Record.
 *
 * **Note:** iOS has limitations writing to HCE devices. This function
 * attempts the write operation but may fail on iOS devices.
 *
 * **Process:** Request NFC technology → Encode token as NDEF → Write to device → Cleanup session
 * **Effects:** NDEF message written, session cleanup
 *
 * @async
 * @param {string} cashuToken - The Cashu token string (starting with "cashu...") to write
 * @returns {Promise<boolean>} True if write was successful, false otherwise
 * @throws {Error} When NFC technology is not available or write operation fails
 *
 * @example
 * const success = await writeCashuTokenToPOS('cashuAeyJ0b2tlbiI6...');
 * if (success) {
 *   // Payment token successfully sent to POS
 * }
 */
export async function writeCashuTokenToPOS(cashuToken: string): Promise<boolean> {
  let writeSuccessful = false;

  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold your device near the POS terminal to send payment',
    });

    // Create NDEF text record with Cashu token
    const ndefBytes = Ndef.encodeMessage([Ndef.textRecord(cashuToken)]);

    if (ndefBytes) {
      await NfcManager.ndefHandler.writeNdefMessage(ndefBytes);

      if (Platform.OS === 'ios') {
        await NfcManager.setAlertMessageIOS('Payment sent');
      }

      writeSuccessful = true;
    }
  } catch (ex) {
    // On iOS, writing to HCE devices may fail - handle gracefully
    if (Platform.OS === 'ios') {
      console.warn('iOS may have limitations writing to HCE devices:', ex);
      // Still try to show a helpful message
      try {
        await NfcManager.setAlertMessageIOS('Write may have failed - iOS limitation');
      } catch {
        // Ignore alert errors
      }
    }
    handleNFCException(ex);
  } finally {
    NfcManager.cancelTechnologyRequest();
  }

  return writeSuccessful;
}

/**
 * Reads an NDEF payment request and writes a Cashu token back in the same NFC session
 *
 * This function handles bidirectional NDEF communication with Android POS devices
 * that use Host Card Emulation (HCE). It reads the payment request, creates a payment
 * token using the send function, and writes it back without closing the NFC session.
 *
 * If the NFC write fails after the token has been created, the function will automatically
 * call the receive function to reclaim the tokens and restore the balance.
 *
 * **Process:** Request NFC → Read NDEF → Decode request → Validate amount → Create token → Write NDEF → Cleanup session
 * **Effects:** Payment request read, token created and written, session cleanup
 * **Recovery:** If write fails after token creation, tokens are automatically reclaimed via receive
 *
 * @async
 * @param {Function} send - The send function from useSend() hook: (mintUrl: string, amount: number) => Promise<any>
 * @param {Function} receive - The receive function from useReceive() hook: (token: string) => Promise<void>
 * @param {number} [maxAmount] - Optional maximum amount cap to prevent merchants from requesting excessive amounts
 * @returns {Promise<string | null>} The payment request string if read and write successful, null otherwise
 * @throws {Error} When NFC operations fail or requested amount exceeds maxAmount
 *
 * @example
 * const { send } = useSend();
 * const { receive } = useReceive();
 * const paymentRequest = await readAndWriteNdefPOS(send, receive, 10000); // Max 10,000 sats
 * if (paymentRequest) {
 *   // Payment request received and token sent
 * }
 */
export async function readAndWriteNdefPOS(
  send: (mintUrl: string, amount: number) => Promise<any>,
  receive: (token: string) => Promise<void>,
  maxAmount?: number
): Promise<string | null> {
  let paymentRequest: string | null = null;
  let writeSuccessful = false;

  try {
    // Request NFC technology once for both read and write
    console.log('[readAndWriteNdefPOS] Requesting NFC technology...');
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold your device near the POS terminal',
    });
    console.log('[readAndWriteNdefPOS] NFC technology requested successfully');

    // Step 1: Read payment request
    console.log('[readAndWriteNdefPOS] Reading payment request...');
    const tag = await NfcManager.getTag();
    console.log('[readAndWriteNdefPOS] Tag received:', tag ? 'yes' : 'no');
    console.log('[readAndWriteNdefPOS] Tag details:', JSON.stringify(tag, null, 2));

    if (tag) {
      console.log('[readAndWriteNdefPOS] Tag has NDEF message:', !!tag.ndefMessage);
      console.log('[readAndWriteNdefPOS] NDEF message length:', tag.ndefMessage?.length || 0);

      if (tag.ndefMessage && tag.ndefMessage.length > 0) {
        const ndefRecords = tag.ndefMessage;
        console.log('[readAndWriteNdefPOS] Processing', ndefRecords.length, 'NDEF records');

        for (let i = 0; i < ndefRecords.length; i++) {
          const record = ndefRecords[i];
          console.log(`[readAndWriteNdefPOS] Record ${i}:`, {
            tnf: record.tnf,
            typeLength: record.type?.length || 0,
            payloadLength: record.payload?.length || 0,
          });

          try {
            if (record.tnf === 1 && record.type && record.type.length > 0) {
              const typeArray = Array.isArray(record.type) ? record.type : [record.type];
              const typeString = String.fromCharCode(
                ...typeArray.map((v: number | string) => Number(v))
              );
              console.log(`[readAndWriteNdefPOS] Record ${i} type:`, typeString);

              if (typeString === 'T' && record.payload) {
                let payloadArray: Uint8Array;
                if (record.payload instanceof Uint8Array) {
                  payloadArray = record.payload;
                } else if (Array.isArray(record.payload)) {
                  payloadArray = new Uint8Array(
                    record.payload.map((v: number | string) => Number(v))
                  );
                } else {
                  console.log(`[readAndWriteNdefPOS] Record ${i} payload format unexpected`);
                  continue;
                }
                const text = Ndef.text.decodePayload(payloadArray);
                console.log(
                  `[readAndWriteNdefPOS] Record ${i} decoded text:`,
                  text?.substring(0, 50)
                );
                if (text) {
                  paymentRequest = text;
                  break;
                }
              }
            }
          } catch (decodeError) {
            console.warn(`[readAndWriteNdefPOS] Failed to decode record ${i}:`, decodeError);
          }
        }

        if (paymentRequest) {
          console.log('[readAndWriteNdefPOS] Payment request received:', paymentRequest);
          if (Platform.OS === 'ios') {
            await NfcManager.setAlertMessageIOS('Payment request received, sending token...');
          }
        } else {
          console.log('[readAndWriteNdefPOS] No payment request found in NDEF records');
        }
      } else {
        console.log('[readAndWriteNdefPOS] Tag has no NDEF message');
      }
    } else {
      console.log('[readAndWriteNdefPOS] No tag received');
    }

    // Step 2: Decode payment request and create token
    if (paymentRequest) {
      console.log('[readAndWriteNdefPOS] Decoding payment request...');
      let decodedRequest;
      try {
        decodedRequest = decodePaymentRequest(paymentRequest);
        console.log(
          '[readAndWriteNdefPOS] Decoded request:',
          JSON.stringify(decodedRequest, null, 2)
        );
      } catch (decodeError) {
        console.error('[readAndWriteNdefPOS] Failed to decode payment request:', decodeError);
        throw decodeError;
      }

      if (!decodedRequest) {
        console.log('[readAndWriteNdefPOS] Decoded request is null');
        return null;
      }

      const { amount, mints } = decodedRequest;

      if (!amount || amount <= 0) {
        console.error('[readAndWriteNdefPOS] Invalid amount:', amount);
        return null;
      }

      // Check if requested amount exceeds the safety cap
      if (maxAmount !== undefined && amount > maxAmount) {
        console.error(
          `[readAndWriteNdefPOS] Amount ${amount} exceeds maximum allowed ${maxAmount} sats`
        );
        if (Platform.OS === 'ios') {
          await NfcManager.setAlertMessageIOS(
            `Payment rejected: ${amount} sats exceeds your ${maxAmount} sat limit`
          );
        } else {
          Alert.alert(
            'Payment Rejected',
            `The merchant requested ${amount} sats which exceeds your safety limit of ${maxAmount} sats.`
          );
        }
        return null;
      }

      if (!mints || mints.length === 0) {
        console.error('[readAndWriteNdefPOS] No mints in payment request');
        return null;
      }

      // Use first mint
      const mintUrl = mints[0];
      console.log('[readAndWriteNdefPOS] Creating token for mint:', mintUrl, 'amount:', amount);

      // Step 3: Create payment token
      let token;
      try {
        token = await send(mintUrl, amount);
        console.log('[readAndWriteNdefPOS] Token created successfully');
      } catch (sendError) {
        console.error('[readAndWriteNdefPOS] Failed to create token:', sendError);
        throw sendError;
      }

      // Step 4: Encode token
      const encodedToken = getEncodedTokenV4(token);
      console.log('[readAndWriteNdefPOS] Token encoded, length:', encodedToken.length);

      // Step 5: Write token back to POS (without closing session)
      console.log('[readAndWriteNdefPOS] Writing token back to POS...');
      const ndefBytes = Ndef.encodeMessage([Ndef.textRecord(encodedToken)]);
      console.log('[readAndWriteNdefPOS] NDEF bytes created:', ndefBytes ? ndefBytes.length : 0);

      if (ndefBytes) {
        try {
          // Verify tag is still connected before attempting write
          console.log('[readAndWriteNdefPOS] Verifying tag connection before write...');
          try {
            const currentTag = await NfcManager.getTag();
            if (!currentTag) {
              throw new Error('Tag connection lost - tag is no longer available');
            }
            console.log('[readAndWriteNdefPOS] Tag connection verified');
          } catch (connectionError) {
            console.warn('[readAndWriteNdefPOS] Tag connection check failed:', connectionError);
            // Continue anyway - the write attempt will fail if connection is truly lost
          }

          console.log('[readAndWriteNdefPOS] Attempting to write NDEF message...');
          await NfcManager.ndefHandler.writeNdefMessage(ndefBytes);
          writeSuccessful = true;
          console.log('[readAndWriteNdefPOS] Token written successfully');

          if (Platform.OS === 'ios') {
            await NfcManager.setAlertMessageIOS('Payment sent');
          }
        } catch (writeError) {
          console.error('[readAndWriteNdefPOS] Write error:', writeError);
          console.error('[readAndWriteNdefPOS] Write error type:', writeError?.constructor?.name);
          const errorMessage =
            writeError instanceof Error ? writeError.message : String(writeError);
          console.error('[readAndWriteNdefPOS] Write error message:', errorMessage);

          // NFC write failed after token was created - reclaim the tokens
          console.log('[readAndWriteNdefPOS] Attempting to reclaim tokens via receive...');
          try {
            await receive(encodedToken);
            console.log('[readAndWriteNdefPOS] Tokens reclaimed successfully');
            if (Platform.OS === 'ios') {
              try {
                await NfcManager.setAlertMessageIOS('NFC write failed - tokens reclaimed');
              } catch {
                // Ignore alert errors
              }
            }
          } catch (receiveError) {
            console.error('[readAndWriteNdefPOS] Failed to reclaim tokens:', receiveError);
            // Log the token so user can manually recover if needed
            console.error('[readAndWriteNdefPOS] Unreclaimed token:', encodedToken);
            if (Platform.OS === 'ios') {
              try {
                await NfcManager.setAlertMessageIOS('NFC write failed - token recovery failed');
              } catch {
                // Ignore alert errors
              }
            }
          }

          // Check if it's a TagUpdateFailure (common on iOS with HCE devices)
          if (writeError instanceof NfcError.TagUpdateFailure) {
            console.warn(
              '[readAndWriteNdefPOS] TagUpdateFailure - iOS may not support writing to HCE devices'
            );
            writeSuccessful = false;
          } else if (writeError instanceof NfcError.TagConnectionLost) {
            console.warn(
              '[readAndWriteNdefPOS] TagConnectionLost - NFC connection lost during write operation'
            );
            writeSuccessful = false;
          } else {
            // For other errors, mark as unsuccessful but don't throw since we tried to reclaim
            writeSuccessful = false;
          }
        }
      } else {
        console.log('[readAndWriteNdefPOS] Failed to create NDEF bytes');
      }
    } else {
      console.log('[readAndWriteNdefPOS] Skipping write - no payment request received');
    }
  } catch (ex) {
    console.error('[readAndWriteNdefPOS] Error:', ex);
    console.error('[readAndWriteNdefPOS] Error details:', JSON.stringify(ex, null, 2));
    handleNFCException(ex);
  } finally {
    // Only close session once at the end
    console.log('[readAndWriteNdefPOS] Closing NFC session');
    NfcManager.cancelTechnologyRequest();
  }

  console.log('[readAndWriteNdefPOS] Final result:', {
    paymentRequest: paymentRequest ? paymentRequest.substring(0, 50) + '...' : null,
    writeSuccessful,
  });

  // Only return payment request if the write was successful
  // If write failed, tokens were reclaimed so we should indicate failure
  if (paymentRequest && writeSuccessful) {
    return paymentRequest;
  }

  return null;
}
