/**
 * NFC Cashu payment flow: read request from POS, create token, write token back.
 * Single session (IsoDep held until done or error). Handles Lightning invoice redirect.
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { NfcError } from './errors';
import { SELECT_AID, SELECT_NDEF, readBinary, updateBinary, MAX_CHUNK_SIZE } from './constants';
import { sendApdu, getStatusMessage } from './apdu';
import { buildTextNdef, decodeTextRecord } from './ndef';
import { selectBestMint } from './mint-selection';
import { isNfcSupported, isNfcEnabled } from './status';
import { log, logDebug, logError, logWarn } from './logger';
import { isLightningInvoice, lnTrim, getLightningAmount } from '@/helper/coco/utils';

export interface PaymentOptions {
  createToken: (mintUrl: string, amount: number) => Promise<string>;
  recoverToken: (token: string) => Promise<void>;
  getAvailableMints?: () => Record<string, number>;
  /** @deprecated Use getAvailableMints for live state reads. */
  availableMints?: Record<string, number>;
  preferredMint?: string;
  maxAmountSats?: number;
  onScanRead?: (raw: string) => void;
  onLightningInvoice?: (invoice: string, amount: number) => void;
}

export interface PaymentResult {
  paymentRequest: string;
  mintUrl: string;
  amount: number;
}

const MINT_READINESS_TIMEOUT_MS = 5000;
const MINT_READINESS_POLL_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAvailableMints(
  resolveMints: () => Record<string, number>,
  timeoutMs: number = MINT_READINESS_TIMEOUT_MS,
  pollMs: number = MINT_READINESS_POLL_MS
): Promise<Record<string, number>> {
  const start = Date.now();
  let latestMints = resolveMints();
  if (Object.keys(latestMints).length > 0) return latestMints;

  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    latestMints = resolveMints();
    if (Object.keys(latestMints).length > 0) return latestMints;
  }

  return latestMints;
}

export async function performNfcPayment(options: PaymentOptions): Promise<PaymentResult> {
  const {
    createToken,
    recoverToken,
    getAvailableMints,
    availableMints,
    preferredMint,
    maxAmountSats,
    onScanRead,
    onLightningInvoice,
  } = options;

  log('Starting NFC payment flow...');
  const resolveAvailableMints = (): Record<string, number> =>
    (getAvailableMints ? getAvailableMints() : availableMints) ?? {};

  if (preferredMint) log(`Preferred mint: ${preferredMint}`);
  if (maxAmountSats !== undefined) log(`Max amount: ${maxAmountSats} sats`);

  if (!(await isNfcSupported())) {
    throw new NfcError('NFC is not supported on this device', 'NOT_SUPPORTED');
  }
  if (!(await isNfcEnabled())) {
    throw new NfcError(
      'NFC is disabled. Please enable NFC in your device settings.',
      'NOT_ENABLED'
    );
  }

  logDebug('Requesting IsoDep technology...');
  try {
    await NfcManager.requestTechnology(NfcTech.IsoDep);
    log('IsoDep technology acquired, communicating with POS...');
  } catch (error) {
    logError('Failed to acquire IsoDep technology:', error);
    throw new NfcError(
      `Failed to connect to NFC tag: ${error instanceof Error ? error.message : String(error)}`,
      'TECHNOLOGY_REQUEST_FAILED'
    );
  }

  let createdToken: string | null = null;
  let paymentRequest: string | null = null;
  let selectedMint: string | null = null;
  let amount: number | null = null;

  const releaseNfc = async (): Promise<void> => {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch (e) {
      logWarn('Failed to release NFC technology:', e);
    }
  };

  try {
    // ---------- Phase 1: Read payment request ----------
    log('Phase 1: Reading payment request...');

    let r = await sendApdu(SELECT_AID, 'SELECT AID');
    if (!r.ok) {
      throw new NfcError(
        `AID not accepted by tag (${getStatusMessage(r.sw)})`,
        'AID_SELECT_FAILED',
        r.sw
      );
    }

    r = await sendApdu(SELECT_NDEF, 'SELECT NDEF');
    if (!r.ok) {
      throw new NfcError(
        `NDEF file not accessible (${getStatusMessage(r.sw)})`,
        'NDEF_SELECT_FAILED',
        r.sw
      );
    }

    r = await sendApdu(readBinary(0, 2), 'READ NLEN');
    if (!r.ok) {
      throw new NfcError(
        `Failed reading NLEN (${getStatusMessage(r.sw)})`,
        'READ_NLEN_FAILED',
        r.sw
      );
    }

    const nlen = (r.payload[0] << 8) | r.payload[1];
    logDebug(`NLEN = ${nlen} bytes`);

    if (nlen === 0) {
      throw new NfcError(
        'NDEF file is empty (NLEN=0). No payment request available.',
        'EMPTY_NDEF'
      );
    }

    let ndefBytes: number[] = [];
    if (nlen <= MAX_CHUNK_SIZE) {
      r = await sendApdu(readBinary(2, nlen), 'READ NDEF');
      if (!r.ok) {
        throw new NfcError(
          `Failed reading NDEF content (${getStatusMessage(r.sw)})`,
          'READ_NDEF_FAILED',
          r.sw
        );
      }
      ndefBytes = r.payload;
    } else {
      logDebug('Large NDEF message, reading in chunks...');
      let offset = 2;
      let remaining = nlen;
      while (remaining > 0) {
        const chunkSize = Math.min(remaining, MAX_CHUNK_SIZE);
        r = await sendApdu(readBinary(offset, chunkSize), `READ chunk @${offset}`);
        if (!r.ok) {
          throw new NfcError(
            `Failed reading NDEF chunk at offset ${offset}`,
            'READ_NDEF_CHUNK_FAILED',
            r.sw
          );
        }
        ndefBytes.push(...r.payload);
        offset += chunkSize;
        remaining -= chunkSize;
      }
    }

    paymentRequest = decodeTextRecord(ndefBytes);
    log(`Read payment request (${paymentRequest.length} chars)`);

    if (!paymentRequest || paymentRequest.length === 0) {
      throw new NfcError(
        'POS terminal returned empty payment request. The terminal may not be ready.',
        'EMPTY_PAYMENT_REQUEST'
      );
    }

    onScanRead?.(paymentRequest);
    logDebug(`Preview: ${paymentRequest.substring(0, 60)}...`);

    // ---------- Lightning invoice redirect ----------
    const trimmedForLightning = lnTrim(paymentRequest);
    if (isLightningInvoice(trimmedForLightning)) {
      log('Lightning invoice detected via NFC');
      const lnAmount = getLightningAmount(trimmedForLightning);
      if (onLightningInvoice) {
        await releaseNfc();
        onLightningInvoice(trimmedForLightning, lnAmount);
        return { paymentRequest, mintUrl: '', amount: lnAmount };
      }
      throw new NfcError(
        'Lightning invoice detected. Please use the Lightning payment flow.',
        'LIGHTNING_INVOICE_DETECTED'
      );
    }

    // ---------- Phase 2: Decode and validate ----------
    log('Phase 2: Decoding payment request...');
    const { decodePaymentRequest } = await import('@cashu/cashu-ts');
    const decoded = decodePaymentRequest(paymentRequest);

    amount = decoded.amount ?? 0;
    const unit = decoded.unit ?? 'sat';
    const allowedMints = decoded.mints ?? [];

    log(`Payment request: ${amount} ${unit}`);
    logDebug(`Allowed mints: ${allowedMints.join(', ') || 'any'}`);

    if (amount <= 0) {
      throw new NfcError('Invalid payment amount', 'INVALID_AMOUNT');
    }

    if (maxAmountSats !== undefined && amount > maxAmountSats) {
      throw new NfcError(
        `Amount ${amount} sats exceeds your limit of ${maxAmountSats} sats`,
        'AMOUNT_EXCEEDED'
      );
    }

    const liveAvailableMints = await waitForAvailableMints(resolveAvailableMints);
    if (Object.keys(liveAvailableMints).length === 0) {
      throw new NfcError(
        'No mints available. Please add a mint to your wallet first.',
        'NO_AVAILABLE_MINTS'
      );
    }

    const mintSelection = selectBestMint(allowedMints, liveAvailableMints, amount, preferredMint);
    selectedMint = mintSelection.mintUrl;
    log(`Selected mint: ${selectedMint} (balance: ${mintSelection.balance} sats)`);

    // ---------- Phase 3: Create token ----------
    log('Phase 3: Creating token...');
    try {
      createdToken = await createToken(selectedMint, amount);
    } catch (error) {
      logError('Token creation failed:', error);
      throw new NfcError(
        `Failed to create token: ${error instanceof Error ? error.message : String(error)}`,
        'TOKEN_CREATION_FAILED'
      );
    }

    if (!createdToken || createdToken.length === 0) {
      throw new NfcError('Token creation returned empty token', 'INVALID_TOKEN');
    }

    log(`Token created (${createdToken.length} chars)`);

    // ---------- Phase 4: Write token back ----------
    log('Phase 4: Writing token back to POS...');

    r = await sendApdu(SELECT_NDEF, 'SELECT NDEF (write)');
    if (!r.ok) {
      throw new NfcError(
        `NDEF file not accessible for write (${getStatusMessage(r.sw)})`,
        'NDEF_SELECT_FAILED',
        r.sw
      );
    }

    const ndef = buildTextNdef(createdToken);
    r = await sendApdu(updateBinary(0, [ndef[0], ndef[1]]), 'WRITE NLEN');
    if (!r.ok) {
      throw new NfcError(
        `Failed writing NLEN (${getStatusMessage(r.sw)})`,
        'WRITE_NLEN_FAILED',
        r.sw
      );
    }

    let offset = 2;
    const body = ndef.slice(2);
    const totalChunks = Math.ceil(body.length / MAX_CHUNK_SIZE);
    for (let chunkNum = 0; offset - 2 < body.length; chunkNum++) {
      const chunk = body.slice(offset - 2, offset - 2 + MAX_CHUNK_SIZE);
      logDebug(`Writing chunk ${chunkNum + 1}/${totalChunks}: ${chunk.length} bytes`);
      r = await sendApdu(updateBinary(offset, chunk), `WRITE chunk ${chunkNum + 1}`);
      if (!r.ok) {
        throw new NfcError(
          `Failed writing chunk (${getStatusMessage(r.sw)})`,
          'WRITE_CHUNK_FAILED',
          r.sw
        );
      }
      offset += chunk.length;
    }

    log('NFC payment completed successfully!');
    await releaseNfc();

    return {
      paymentRequest,
      mintUrl: selectedMint,
      amount,
    };
  } catch (error) {
    if (createdToken) {
      logWarn('Write failed after token creation, attempting recovery...');
      try {
        await recoverToken(createdToken);
        log('Tokens recovered successfully');
      } catch (recoveryError) {
        logError('Token recovery failed:', recoveryError);
      }
    }

    if (error instanceof NfcError) throw error;
    throw new NfcError(
      `NFC payment failed: ${error instanceof Error ? error.message : String(error)}`,
      'PAYMENT_FAILED'
    );
  } finally {
    await releaseNfc();
  }
}

/** Legacy class API: static helpers and performPayment. */
export const NfcPayment = {
  isSupported: isNfcSupported,
  isEnabled: isNfcEnabled,
  performPayment: performNfcPayment,
};
