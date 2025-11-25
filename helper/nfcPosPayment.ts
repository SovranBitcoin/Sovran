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
    const paymentRequestString = await readNdefFromPOS();

    if (!paymentRequestString) {
      console.log('[handlePOSPayment] Failed to read payment request from POS device');
      return false;
    }

    // Step 2: Decode payment request using cashu-ts
    let paymentRequest;
    try {
      paymentRequest = decodePaymentRequest(paymentRequestString);
    } catch (error) {
      console.error('[handlePOSPayment] Failed to decode payment request:', error);
      return false;
    }

    if (!paymentRequest) {
      console.error('[handlePOSPayment] Invalid payment request format');
      return false;
    }

    // Extract payment details
    const amount = paymentRequest.amount || 0;
    const unit = paymentRequest.unit || 'sat';
    const allowedMints = paymentRequest.mints || [];

    if (amount <= 0) {
      console.error('[handlePOSPayment] Invalid payment amount:', amount);
      return false;
    }

    // Step 3: Determine mint to use
    let targetMintUrl = mintUrl;

    if (!targetMintUrl) {
      // If no mint specified, use the first allowed mint or get from user's selected mints
      if (allowedMints.length > 0) {
        targetMintUrl = allowedMints[0];
      } else {
        console.error('[handlePOSPayment] No mint specified for payment');
        return false;
      }
    }

    // Validate mint is trusted/allowed
    if (allowedMints.length > 0 && !allowedMints.includes(targetMintUrl)) {
      console.error('[handlePOSPayment] Mint not allowed for this payment:', targetMintUrl);
      return false;
    }

    // Step 4: Create Cashu token
    console.log(`[handlePOSPayment] Creating payment token for ${amount} ${unit}...`);
    const token = await manager.wallet.send(targetMintUrl, amount);
    const encodedToken = getEncodedTokenV4(token);

    // Step 5: Write token back to POS
    console.log('[handlePOSPayment] Sending payment token to POS...');
    const writeSuccess = await writeCashuTokenToPOS(encodedToken);

    if (writeSuccess) {
      console.log(`[handlePOSPayment] Payment of ${amount} ${unit} sent successfully!`);
      return true;
    } else {
      // NFC write failed - attempt to reclaim tokens
      if (receive) {
        console.log('[handlePOSPayment] Attempting to reclaim tokens via receive...');
        try {
          await receive(encodedToken);
          console.log('[handlePOSPayment] Tokens reclaimed successfully');
        } catch (receiveError) {
          console.error('[handlePOSPayment] Failed to reclaim tokens:', receiveError);
          console.error('[handlePOSPayment] Unreclaimed token:', encodedToken);
        }
      }
      return false;
    }
  } catch (error) {
    console.error('[handlePOSPayment] Payment failed:', error);
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
    // Step 1 & 2: Read payment request, create token, and write back in same NFC session
    console.log('[handlePOSPaymentTest] Starting bidirectional NFC communication...');
    const paymentRequestString = await readAndWriteNdefPOS(_send, _receive);

    if (!paymentRequestString) {
      console.log('[handlePOSPaymentTest] Failed to read payment request or write token');
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

    const amount = paymentRequest?.amount || 0;
    const unit = paymentRequest?.unit || 'sat';
    console.log(`[handlePOSPaymentTest] Payment of ${amount} ${unit} completed successfully`);

    return true;
  } catch (error) {
    console.error('[handlePOSPaymentTest] Failed:', error);
    return false;
  }
}
