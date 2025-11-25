/**
 * @fileoverview NFC POS Payment Handler - Handles payment requests from Android POS terminals
 *
 * @module helper/nfcPosPayment
 *
 * @description
 * **POS Payment Flow Handler**
 * - Reads payment requests from Android POS devices via NDEF
 * - Parses payment request format (creq...)
 * - Validates payment against user's available mints
 * - Creates Cashu tokens for the payment amount
 * - Writes tokens back to POS device
 *
 * **Usage:**
 * ```typescript
 * import { handlePOSPayment } from '@/helper/nfcPosPayment';
 *
 * await handlePOSPayment();
 * ```
 */

import { readNdefFromPOS, writeCashuTokenToPOS, readAndWriteNdefPOS } from './nfc';
import { decodePaymentRequest, getEncodedTokenV4 } from '@cashu/cashu-ts';
import { popup } from './popup';
import type { Manager } from 'coco-cashu-core';

/**
 * Handles the complete POS payment flow
 *
 * This function orchestrates the bidirectional NDEF communication:
 * 1. Reads payment request from POS device
 * 2. Parses and validates the payment request
 * 3. Creates a Cashu token for the requested amount
 * 4. Writes the token back to the POS device
 * 5. If write fails, attempts to reclaim the token via receive
 *
 * **Process:** Read NDEF → Parse request → Validate → Create token → Write NDEF
 * **Effects:** Payment token created and sent, user feedback shown
 * **Recovery:** If write fails after token creation, tokens are automatically reclaimed
 *
 * @async
 * @param manager - The Coco Manager instance (required)
 * @param receive - The receive function to reclaim tokens on failure (optional)
 * @param mintUrl - The mint URL to use for creating the token (optional, will use from payment request if not provided)
 * @returns {Promise<boolean>} True if payment was successful, false otherwise
 * @throws {Error} When NFC operations fail or payment creation fails
 *
 * @example
 * const manager = useManager();
 * const { receive } = useReceive();
 * const success = await handlePOSPayment(manager, receive, 'https://mint.example.com');
 */
export async function handlePOSPayment(
  manager: Manager,
  receive?: (token: string) => Promise<void>,
  mintUrl?: string
): Promise<boolean> {
  try {
    // Step 1: Read payment request from POS
    popup({
      message: 'Reading payment request from POS...',
      type: 'info',
    });

    const paymentRequestString = await readNdefFromPOS();

    if (!paymentRequestString) {
      popup({
        message: 'Failed to read payment request from POS device',
        emoji: '🚨',
        type: 'error',
      });
      return false;
    }

    // Step 2: Decode payment request using cashu-ts
    let paymentRequest;
    try {
      paymentRequest = decodePaymentRequest(paymentRequestString);
    } catch (error) {
      console.error('[handlePOSPayment] Failed to decode payment request:', error);
      popup({
        message: 'Invalid payment request format',
        emoji: '🚨',
        type: 'error',
      });
      return false;
    }

    if (!paymentRequest) {
      popup({
        message: 'Invalid payment request format',
        emoji: '🚨',
        type: 'error',
      });
      return false;
    }

    // Extract payment details
    const amount = paymentRequest.amount || 0;
    const unit = paymentRequest.unit || 'sat';
    const allowedMints = paymentRequest.mints || [];

    if (amount <= 0) {
      popup({
        message: 'Invalid payment amount',
        emoji: '🚨',
        type: 'error',
      });
      return false;
    }

    // Step 3: Determine mint to use
    let targetMintUrl = mintUrl;

    if (!targetMintUrl) {
      // If no mint specified, use the first allowed mint or get from user's selected mints
      if (allowedMints.length > 0) {
        targetMintUrl = allowedMints[0];
      } else {
        // Get user's default mint (would need to be passed in or retrieved)
        popup({
          message: 'No mint specified for payment',
          emoji: '🚨',
          type: 'error',
        });
        return false;
      }
    }

    // Validate mint is trusted/allowed
    if (allowedMints.length > 0 && !allowedMints.includes(targetMintUrl)) {
      popup({
        message: `Mint ${targetMintUrl} is not allowed for this payment`,
        emoji: '🚨',
        type: 'error',
      });
      return false;
    }

    // Step 4: Create Cashu token
    popup({
      message: `Creating payment token for ${amount} ${unit}...`,
      type: 'info',
    });

    const token = await manager.wallet.send(targetMintUrl, amount);
    const encodedToken = getEncodedTokenV4(token);

    // Step 5: Write token back to POS
    popup({
      message: 'Sending payment token to POS...',
      type: 'info',
    });

    const writeSuccess = await writeCashuTokenToPOS(encodedToken);

    if (writeSuccess) {
      popup({
        message: `Payment of ${amount} ${unit} sent successfully!`,
        emoji: '✅',
        type: 'success',
      });
      return true;
    } else {
      // NFC write failed - attempt to reclaim tokens
      if (receive) {
        console.log('[handlePOSPayment] Attempting to reclaim tokens via receive...');
        try {
          await receive(encodedToken);
          console.log('[handlePOSPayment] Tokens reclaimed successfully');
          popup({
            message: 'NFC write failed - tokens reclaimed to wallet',
            emoji: '⚠️',
            type: 'warning',
          });
        } catch (receiveError) {
          console.error('[handlePOSPayment] Failed to reclaim tokens:', receiveError);
          console.error('[handlePOSPayment] Unreclaimed token:', encodedToken);
          popup({
            message: 'NFC write failed and token recovery failed. Check logs for token.',
            emoji: '🚨',
            type: 'error',
          });
        }
      } else {
        popup({
          message: 'Payment token created but failed to send to POS.',
          emoji: '⚠️',
          type: 'warning',
        });
      }
      return false;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    popup({
      message: `Payment failed: ${errorMessage}`,
      emoji: '🚨',
      type: 'error',
    });
    return false;
  }
}

/**
 * Simplified handler that reads payment request and sends payment token
 *
 * This function reads a payment request from POS, decodes it, creates a payment token,
 * and writes it back to the POS device. If the NFC write fails, tokens are automatically
 * reclaimed to prevent balance loss.
 *
 * @param send - The send function from useSend() hook to create payment tokens
 * @param receive - The receive function from useReceive() hook to reclaim tokens on failure
 * @returns {Promise<boolean>} True if payment was successful
 */
export async function handlePOSPaymentTest(
  _send: (mintUrl: string, amount: number) => Promise<any>,
  _receive: (token: string) => Promise<void>
): Promise<boolean> {
  try {
    // Step 1: Read payment request from POS
    popup({
      message: 'Reading payment request from POS...',
      type: 'info',
    });

    // Step 1 & 2: Read payment request, create token, and write back in same NFC session
    console.log('[handlePOSPaymentTest] Starting bidirectional NFC communication...');
    const paymentRequestString = await readAndWriteNdefPOS(_send, _receive);

    if (!paymentRequestString) {
      console.log('[handlePOSPaymentTest] Failed to read payment request or write token');
      popup({
        message: 'Failed to complete NFC payment',
        emoji: '🚨',
        type: 'error',
      });
      return false;
    }

    console.log('[handlePOSPaymentTest] Payment request received:', paymentRequestString);
    console.log('[handlePOSPaymentTest] Payment request length:', paymentRequestString.length);
    console.log(
      '[handlePOSPaymentTest] Payment request starts with creq:',
      paymentRequestString.startsWith('creq')
    );

    // Step 3: Decode payment request (for logging/validation)
    console.log('[handlePOSPaymentTest] Decoding payment request...');
    let paymentRequest;
    try {
      paymentRequest = decodePaymentRequest(paymentRequestString);
      console.log(
        '[handlePOSPaymentTest] Decoded payment request:',
        JSON.stringify(paymentRequest, null, 2)
      );
    } catch (error) {
      console.warn('[handlePOSPaymentTest] Failed to decode payment request:', error);
      // Still consider it successful if token was written
    }

    const writeSuccess = true; // If we got here, the write succeeded

    if (writeSuccess) {
      const amount = paymentRequest?.amount || 0;
      const unit = paymentRequest?.unit || 'sat';
      popup({
        message: `Payment of ${amount} ${unit} sent successfully!`,
        emoji: '✅',
        type: 'success',
      });
      console.log('[handlePOSPaymentTest] Payment completed successfully');
    } else {
      popup({
        message: 'Payment token created but failed to send to POS',
        emoji: '⚠️',
        type: 'warning',
      });
      console.log('[handlePOSPaymentTest] Token created but write failed');
    }

    return writeSuccess;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    popup({
      message: `Test failed: ${errorMessage}`,
      emoji: '🚨',
      type: 'error',
    });
    return false;
  }
}
