/**
 * @fileoverview NFC Payment Service - Contactless Cashu payments
 *
 * @module helper/nfc
 *
 * @description
 * Provides NFC functionality for contactless Cashu payments:
 * - Reads payment requests from POS terminals via NDEF Type 4 Tag protocol
 * - Writes Cashu tokens back to POS terminals
 * - Supports preferred mint selection and max amount limits
 *
 * Uses ISO-DEP (Type 4 Tag) with APDU commands for proper HCE communication.
 *
 * @example
 * ```typescript
 * import { NfcPayment } from '@/helper/nfc';
 *
 * let operationId: string | null = null;
 * const result = await NfcPayment.performPayment({
 *   createToken: async (mintUrl, amount) => {
 *     const { token, historyEntry } = await send(mintUrl, amount);
 *     operationId = historyEntry.operationId;
 *     return getEncodedTokenV4(token);
 *   },
 *   recoverToken: async () => {
 *     if (operationId) await manager.send.rollback(operationId);
 *   },
 *   availableMints: { 'https://mint.example.com': 5000 },
 *   preferredMint: 'https://mint.example.com',
 *   maxAmountSats: 10000,
 * });
 * ```
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { Buffer } from 'buffer';
import { Alert } from 'react-native';

// ============================================================================
// CONSTANTS
// ============================================================================

const LOG_PREFIX = '[NFC]';

/** APDU command to select NDEF Tag Application */
const SELECT_AID = [0x00, 0xa4, 0x04, 0x00, 0x07, 0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00];

/** APDU command to select NDEF file (E104) */
const SELECT_NDEF = [0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04];

/** Build READ BINARY APDU command */
const READ_BINARY = (offset: number, length: number): number[] => [
  0x00,
  0xb0,
  (offset >> 8) & 0xff,
  offset & 0xff,
  length,
];

/** Build UPDATE BINARY APDU command */
const UPDATE_BINARY = (offset: number, data: number[]): number[] => [
  0x00,
  0xd6,
  (offset >> 8) & 0xff,
  offset & 0xff,
  data.length,
  ...data,
];

/** Success status word */
const STATUS_OK = '9000';

/** Status word descriptions for debugging */
const STATUS_CODES: Record<string, string> = {
  '9000': 'Success',
  '6f00': 'No precise diagnosis (command failed)',
  '6a80': 'Incorrect parameters in data field',
  '6a81': 'Function not supported',
  '6a82': 'File not found',
  '6a83': 'Record not found',
  '6a84': 'Not enough memory space',
  '6a86': 'Incorrect P1-P2 parameters',
  '6a87': 'Lc inconsistent with TLV structure',
  '6b00': 'Wrong parameters P1-P2',
  '6c00': 'Wrong length Le',
  '6700': 'Wrong length',
  '6982': 'Security status not satisfied',
  '6985': 'Conditions of use not satisfied',
  '6d00': 'INS not supported',
  '6e00': 'CLA not supported',
};

/** Maximum bytes to read/write per APDU command */
const MAX_CHUNK_SIZE = 240;

/** Short record flag in NDEF header */
const SHORT_RECORD_FLAG = 0x10;

// ============================================================================
// TYPES
// ============================================================================

/** Custom error class for NFC operations */
export class NfcError extends Error {
  code: string;
  statusWord?: string;

  constructor(message: string, code: string, statusWord?: string) {
    super(message);
    this.name = 'NfcError';
    this.code = code;
    this.statusWord = statusWord;
  }
}

/** APDU response structure */
interface ApduResponse {
  ok: boolean;
  raw: number[];
  payload: number[];
  sw: string;
}

/** Options for performing an NFC payment */
interface PaymentOptions {
  /** Function to create a Cashu token from mint URL and amount */
  createToken: (mintUrl: string, amount: number) => Promise<string>;
  /**
   * Function to recover/rollback a token if write fails.
   * Called with the encoded token string for reference/logging.
   * Implementation should use manager.send.rollback(operationId) for proper recovery.
   */
  recoverToken: (token: string) => Promise<void>;
  /** Map of available mint URLs to their balances (required for mint validation) */
  availableMints: Record<string, number>;
  /** User's preferred mint URL (used if in allowed list and has sufficient balance) */
  preferredMint?: string;
  /** Maximum amount in sats (rejects if payment request exceeds this) */
  maxAmountSats?: number;
  /**
   * Callback when payment request is read from NFC.
   * Called regardless of payment success/failure - useful for logging scan history.
   */
  onScanRead?: (raw: string) => void;
}

/** Result of a successful payment */
interface PaymentResult {
  /** The original payment request string */
  paymentRequest: string;
  /** The mint URL that was used */
  mintUrl: string;
  /** The amount in sats */
  amount: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args);
}

function logDebug(...args: unknown[]): void {
  console.debug(LOG_PREFIX, ...args);
}

function logWarn(...args: unknown[]): void {
  console.warn(LOG_PREFIX, ...args);
}

function logError(...args: unknown[]): void {
  console.error(LOG_PREFIX, ...args);
}

function hex(bytes: number[]): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function toBytes(str: string): number[] {
  return Array.from(Buffer.from(str, 'utf8'));
}

function getStatusMessage(sw: string): string {
  return STATUS_CODES[sw.toLowerCase()] || `Unknown status: ${sw}`;
}

// ============================================================================
// APDU COMMUNICATION
// ============================================================================

async function sendApdu(command: number[], label?: string): Promise<ApduResponse> {
  const cmdHex = hex(command);
  logDebug(`>> APDU${label ? ` [${label}]` : ''}: ${cmdHex}`);

  try {
    // Check if isoDepHandler is available
    if (!NfcManager.isoDepHandler) {
      throw new NfcError('IsoDep handler not available', 'HANDLER_NOT_AVAILABLE');
    }

    const response = await NfcManager.isoDepHandler.transceive(command);

    // Check for valid response
    if (!response || response.length < 2) {
      throw new NfcError('Invalid or empty response from NFC device', 'INVALID_RESPONSE');
    }

    const hexResp = hex(response);
    const sw = hexResp.slice(-4);
    const ok = sw.toLowerCase() === STATUS_OK.toLowerCase();

    logDebug(`<< Response: ${hexResp} (SW: ${sw} - ${getStatusMessage(sw)})`);

    return {
      ok,
      raw: response,
      payload: response.slice(0, -2),
      sw,
    };
  } catch (error) {
    // Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStr = errorMessage || 'Unknown error';

    logError('APDU transceive failed:', errorStr);

    // Check for common NFC errors
    if (errorStr.includes('Tag was lost') || errorStr.includes('TagLost')) {
      throw new NfcError(
        'NFC connection lost. Please hold your device steady near the terminal.',
        'TAG_LOST'
      );
    }

    if (errorStr.includes('Transceive failed') || errorStr === '' || errorStr === 'undefined') {
      throw new NfcError(
        'NFC communication failed. Please try again and hold steady.',
        'TRANSCEIVE_FAILED'
      );
    }

    if (error instanceof NfcError) {
      throw error;
    }

    throw new NfcError(`APDU communication failed: ${errorStr}`, 'TRANSCEIVE_FAILED');
  }
}

// ============================================================================
// NDEF ENCODING / DECODING
// ============================================================================

/**
 * Build an NDEF Text record with the given content
 * Supports both Short Record (≤255 bytes) and Normal Record formats
 */
function buildTextNdef(text: string): number[] {
  const lang = 'en';
  const langBytes = toBytes(lang);
  const textBytes = toBytes(text);

  const payload = [langBytes.length, ...langBytes, ...textBytes];

  let recordHeader: number[];

  if (payload.length <= 255) {
    logDebug(`Building Short Record NDEF (payload: ${payload.length} bytes)`);
    recordHeader = [
      0xd1, // MB=1, ME=1, SR=1, TNF=1
      0x01, // type length
      payload.length, // payload length (1 byte)
      0x54, // 'T'
      ...payload,
    ];
  } else {
    logDebug(`Building Normal Record NDEF (payload: ${payload.length} bytes)`);
    const len = payload.length;
    recordHeader = [
      0xc1, // MB=1, ME=1, SR=0, TNF=1
      0x01, // type length
      (len >> 24) & 0xff, // payload length (4 bytes, big-endian)
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      0x54, // 'T'
      ...payload,
    ];
  }

  const nlen = recordHeader.length;
  logDebug(`NDEF message total size: ${nlen + 2} bytes (NLEN=${nlen})`);
  return [(nlen >> 8) & 0xff, nlen & 0xff, ...recordHeader];
}

/**
 * Decode an NDEF Text record from raw bytes
 * Supports both Short Record and Normal Record formats
 */
function decodeTextRecord(ndef: number[]): string {
  if (!ndef || ndef.length < 4) {
    throw new NfcError(
      `Invalid NDEF data: too short (${ndef?.length || 0} bytes)`,
      'INVALID_NDEF_FORMAT'
    );
  }

  const header = ndef[0];
  const typeLen = ndef[1];
  const isShortRecord = (header & SHORT_RECORD_FLAG) !== 0;

  logDebug(
    `Parsing NDEF: header=0x${header.toString(16)}, typeLen=${typeLen}, SR=${isShortRecord}`
  );

  const tnf = header & 0x07;
  if (tnf !== 0x01) {
    logWarn(`Unexpected TNF: ${tnf} (expected 1 for well-known type)`);
  }

  let payloadLen: number;
  let typeFieldStart: number;

  if (isShortRecord) {
    payloadLen = ndef[2];
    typeFieldStart = 3;
  } else {
    if (ndef.length < 7) {
      throw new NfcError('Invalid NDEF: normal record header too short', 'INVALID_NDEF_FORMAT');
    }
    payloadLen = ((ndef[2] << 24) | (ndef[3] << 16) | (ndef[4] << 8) | ndef[5]) >>> 0;
    typeFieldStart = 6;
  }

  logDebug(`Payload length: ${payloadLen}, type field starts at: ${typeFieldStart}`);

  if (typeFieldStart >= ndef.length) {
    throw new NfcError('Invalid NDEF: type field offset out of bounds', 'INVALID_NDEF_FORMAT');
  }

  const type = ndef[typeFieldStart];
  if (type !== 0x54) {
    throw new NfcError(
      `Not a Text record (type=0x${type.toString(16)}, expected 0x54 'T')`,
      'NOT_TEXT_RECORD'
    );
  }

  const payloadStart = typeFieldStart + typeLen;

  if (payloadStart >= ndef.length) {
    throw new NfcError('Invalid NDEF: payload start out of bounds', 'INVALID_NDEF_FORMAT');
  }

  const status = ndef[payloadStart];
  const langLen = status & 0x3f;
  const isUtf16 = (status & 0x80) !== 0;

  logDebug(`Text record: status=0x${status.toString(16)}, langLen=${langLen}, UTF-16=${isUtf16}`);

  if (isUtf16) {
    logWarn('UTF-16 encoding detected - assuming UTF-8');
  }

  const textStart = payloadStart + 1 + langLen;
  const textLen = payloadLen - 1 - langLen;

  if (textStart + textLen > ndef.length) {
    throw new NfcError(
      `Invalid NDEF: text data out of bounds (textStart=${textStart}, textLen=${textLen}, ndefLen=${ndef.length})`,
      'INVALID_NDEF_FORMAT'
    );
  }

  const textBytes = ndef.slice(textStart, textStart + textLen);
  const text = Buffer.from(textBytes).toString('utf8');

  logDebug(`Decoded text: ${textLen} bytes -> ${text.length} chars`);

  return text;
}

// ============================================================================
// MINT SELECTION
// ============================================================================

/**
 * Normalize a mint URL for consistent comparison
 * - Removes trailing slashes
 * - Converts to lowercase
 */
function normalizeMintUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

/**
 * Find a mint URL in the available mints, accounting for URL format differences
 * Returns the original key from availableMints if found, otherwise undefined
 */
function findMintInAvailable(
  mintUrl: string,
  availableMints: Record<string, number>
): string | undefined {
  const normalizedSearch = normalizeMintUrl(mintUrl);
  for (const key of Object.keys(availableMints)) {
    if (normalizeMintUrl(key) === normalizedSearch) {
      return key;
    }
  }
  return undefined;
}

/** Result of mint selection */
interface MintSelectionResult {
  mintUrl: string;
  balance: number;
}

/**
 * Select the best mint for payment based on allowed mints and available balances
 *
 * Priority:
 * 1. User's preferred mint (if in allowed list AND has sufficient balance)
 * 2. Any available mint with sufficient balance (sorted by balance descending)
 * 3. Throw error if no compatible mint found
 *
 * @param allowedMints - Array of mint URLs allowed by the payment request (from POS)
 * @param availableMints - Map of the app's available mint URLs to their balances
 * @param amount - Required amount in sats
 * @param preferredMint - The user's preferred/selected mint URL
 * @returns The selected mint URL and its balance
 * @throws {NfcError} If no compatible mint is found
 */
function selectBestMint(
  allowedMints: string[] | undefined,
  availableMints: Record<string, number>,
  amount: number,
  preferredMint?: string
): MintSelectionResult {
  const appMintUrls = Object.keys(availableMints);

  log(`Available app mints: ${appMintUrls.length}`);
  logDebug(`App mints: ${appMintUrls.join(', ')}`);

  // If no allowed mints specified by POS, any app mint with sufficient balance works
  if (!allowedMints || allowedMints.length === 0) {
    log('No allowed mints specified by POS, using any available mint');

    // Use URL normalization to find the preferred mint
    const matchedPreferredMint = preferredMint
      ? findMintInAvailable(preferredMint, availableMints)
      : undefined;

    // Debug: Log preferred mint info
    log(`Preferred mint (input): ${preferredMint || 'none'}`);
    log(`Preferred mint (matched): ${matchedPreferredMint || 'not found'}`);
    if (matchedPreferredMint) {
      log(`Preferred mint balance: ${availableMints[matchedPreferredMint]}`);
    }
    logDebug(`Available mint URLs: ${appMintUrls.join(', ')}`);

    // Debug Alert to show mint selection info
    Alert.alert(
      'Mint Selection Debug',
      `Preferred (input): ${preferredMint || 'none'}\n` +
        `Preferred (matched): ${matchedPreferredMint || 'not found'}\n` +
        `Balance: ${matchedPreferredMint ? availableMints[matchedPreferredMint] : 'N/A'}\n` +
        `Amount needed: ${amount}\n` +
        `Available mints: ${appMintUrls.join(', ')}`,
      [{ text: 'OK' }]
    );

    // Check preferred mint first (using normalized matching)
    if (matchedPreferredMint) {
      const balance = availableMints[matchedPreferredMint];
      if (balance >= amount) {
        log(`Using preferred mint (no restrictions): ${matchedPreferredMint}`);
        return { mintUrl: matchedPreferredMint, balance };
      }
      logWarn(`Preferred mint has insufficient balance: ${balance} < ${amount}`);
    } else if (preferredMint) {
      logWarn(`Preferred mint not found in available mints: ${preferredMint}`);
      logWarn(`Normalized preferred: ${normalizeMintUrl(preferredMint)}`);
      logWarn(`Normalized available: ${appMintUrls.map(normalizeMintUrl).join(', ')}`);
    }

    // Find any mint with sufficient balance
    const mintsWithBalance = appMintUrls
      .filter((url) => availableMints[url] >= amount)
      .sort((a, b) => availableMints[b] - availableMints[a]);

    if (mintsWithBalance.length > 0) {
      const selected = mintsWithBalance[0];
      log(`Using mint with highest balance: ${selected}`);
      return { mintUrl: selected, balance: availableMints[selected] };
    }

    throw new NfcError(
      `Insufficient balance. You need at least ${amount} sats.`,
      'INSUFFICIENT_BALANCE'
    );
  }

  // POS has specified allowed mints - find intersection with app mints (using normalized URLs)
  log(`POS allowed mints: ${allowedMints.length}`);
  logDebug(`Allowed mints: ${allowedMints.join(', ')}`);

  // Find compatible mints by matching normalized URLs
  // Returns the app's mint URL (key in availableMints) for each match
  const compatibleMintMatches: { posUrl: string; appUrl: string }[] = [];
  for (const posMint of allowedMints) {
    const appMint = findMintInAvailable(posMint, availableMints);
    if (appMint) {
      compatibleMintMatches.push({ posUrl: posMint, appUrl: appMint });
    }
  }

  if (compatibleMintMatches.length === 0) {
    // No intersection - the app doesn't have any of the POS's allowed mints
    logWarn(`No compatible mints found`);
    logWarn(`POS mints (normalized): ${allowedMints.map(normalizeMintUrl).join(', ')}`);
    logWarn(`App mints (normalized): ${appMintUrls.map(normalizeMintUrl).join(', ')}`);
    throw new NfcError(
      "This terminal requires a mint you don't have. Add one of the supported mints to your wallet.",
      'NO_COMPATIBLE_MINT'
    );
  }

  const compatibleAppMints = compatibleMintMatches.map((m) => m.appUrl);
  log(`Compatible mints (intersection): ${compatibleAppMints.length}`);

  // Check preferred mint first (must be in compatible list AND have sufficient balance)
  const matchedPreferredMint = preferredMint
    ? findMintInAvailable(preferredMint, availableMints)
    : undefined;

  if (matchedPreferredMint && compatibleAppMints.includes(matchedPreferredMint)) {
    const balance = availableMints[matchedPreferredMint];
    if (balance >= amount) {
      log(`Using preferred mint: ${matchedPreferredMint}`);
      return { mintUrl: matchedPreferredMint, balance };
    }
    logWarn(`Preferred mint has insufficient balance: ${balance} < ${amount}`);
  }

  // Find a compatible mint with sufficient balance (prefer highest balance)
  const mintsWithSufficientBalance = compatibleAppMints
    .filter((url) => availableMints[url] >= amount)
    .sort((a, b) => availableMints[b] - availableMints[a]);

  if (mintsWithSufficientBalance.length > 0) {
    const selected = mintsWithSufficientBalance[0];
    log(`Using compatible mint with sufficient balance: ${selected}`);
    return { mintUrl: selected, balance: availableMints[selected] };
  }

  // We have compatible mints but none have sufficient balance
  const maxBalance = Math.max(...compatibleAppMints.map((url) => availableMints[url]));
  throw new NfcError(
    `Insufficient balance at compatible mints. You need ${amount} sats but your highest balance is ${maxBalance} sats.`,
    'INSUFFICIENT_BALANCE_AT_COMPATIBLE_MINT'
  );
}

// ============================================================================
// NFC PAYMENT CLASS
// ============================================================================

/**
 * Write a Cashu token to an NFC tag for sharing
 *
 * This is a standalone function for writing tokens to NFC tags,
 * separate from the POS payment flow. Useful for P2P token sharing.
 *
 * @param token - The encoded Cashu token string to write
 * @returns true if successful, false otherwise
 */
export async function writeTokenToNFC(token: string): Promise<boolean> {
  log('Starting NFC token write...');

  // Pre-flight checks
  const supported = await NfcPayment.isSupported();
  if (!supported) {
    logError('NFC is not supported on this device');
    return false;
  }

  const enabled = await NfcPayment.isEnabled();
  if (!enabled) {
    logError('NFC is disabled');
    return false;
  }

  try {
    await NfcManager.requestTechnology(NfcTech.IsoDep);
    log('IsoDep technology acquired');

    // SELECT NDEF Tag Application AID
    let r = await sendApdu(SELECT_AID, 'SELECT AID');
    if (!r.ok) {
      throw new NfcError(`AID not accepted (${getStatusMessage(r.sw)})`, 'AID_SELECT_FAILED', r.sw);
    }

    // SELECT NDEF File
    r = await sendApdu(SELECT_NDEF, 'SELECT NDEF');
    if (!r.ok) {
      throw new NfcError(
        `NDEF file not accessible (${getStatusMessage(r.sw)})`,
        'NDEF_SELECT_FAILED',
        r.sw
      );
    }

    // Build NDEF message
    const ndef = buildTextNdef(token);
    const writeNlen = (ndef[0] << 8) | ndef[1];
    logDebug(`NDEF message: NLEN=${writeNlen}, total=${ndef.length} bytes`);

    // Write NLEN first
    r = await sendApdu(UPDATE_BINARY(0, [ndef[0], ndef[1]]), 'WRITE NLEN');
    if (!r.ok) {
      throw new NfcError(
        `Failed writing NLEN (${getStatusMessage(r.sw)})`,
        'WRITE_NLEN_FAILED',
        r.sw
      );
    }

    // Write body in chunks
    let offset = 2;
    const body = ndef.slice(2);
    const totalChunks = Math.ceil(body.length / MAX_CHUNK_SIZE);
    let chunkNum = 0;

    while (offset - 2 < body.length) {
      const chunk = body.slice(offset - 2, offset - 2 + MAX_CHUNK_SIZE);
      chunkNum++;
      logDebug(`Writing chunk ${chunkNum}/${totalChunks}: ${chunk.length} bytes`);

      r = await sendApdu(UPDATE_BINARY(offset, chunk), `WRITE chunk ${chunkNum}`);
      if (!r.ok) {
        throw new NfcError(
          `Failed writing chunk ${chunkNum} (${getStatusMessage(r.sw)})`,
          'WRITE_CHUNK_FAILED',
          r.sw
        );
      }
      offset += chunk.length;
    }

    log('Token written to NFC successfully!');
    return true;
  } catch (error) {
    logError('NFC token write failed:', error);
    return false;
  } finally {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch (cleanupError) {
      logWarn('Failed to release NFC technology:', cleanupError);
    }
  }
}

/**
 * NFC Payment Service for contactless Cashu payments
 *
 * Handles the complete payment flow:
 * 1. Connect to POS terminal via IsoDep
 * 2. Read payment request (NDEF Text record)
 * 3. Decode and validate the request
 * 4. Create token via callback
 * 5. Write token back to POS
 * 6. Recover tokens on failure
 */
export class NfcPayment {
  /**
   * Check if NFC is supported on this device
   */
  static async isSupported(): Promise<boolean> {
    try {
      const supported = await NfcManager.isSupported();
      logDebug(`NFC supported: ${supported}`);
      return supported;
    } catch (error) {
      logWarn('Failed to check NFC support:', error);
      return false;
    }
  }

  /**
   * Check if NFC is currently enabled
   */
  static async isEnabled(): Promise<boolean> {
    try {
      const enabled = await NfcManager.isEnabled();
      logDebug(`NFC enabled: ${enabled}`);
      return enabled;
    } catch (error) {
      logWarn('Failed to check if NFC is enabled:', error);
      return false;
    }
  }

  /**
   * Perform a complete NFC Cashu payment flow
   *
   * This keeps the NFC session open throughout the entire flow:
   * 1. Connect to the POS terminal
   * 2. Read the payment request
   * 3. Validate amount against max limit
   * 4. Select best mint (prefer user's selection)
   * 5. Create token via callback
   * 6. Write the token back to the POS
   * 7. Recover tokens if write fails
   *
   * @param options - Payment options including callbacks and limits
   * @returns Payment result with request details
   * @throws {NfcError} If NFC unavailable, amount exceeded, or operation fails
   *
   * @example
   * ```typescript
   * let operationId: string | null = null;
   * const result = await NfcPayment.performPayment({
   *   createToken: async (mintUrl, amount) => {
   *     const { token, historyEntry } = await send(mintUrl, amount);
   *     operationId = historyEntry.operationId;
   *     return getEncodedTokenV4(token);
   *   },
   *   recoverToken: async () => {
   *     if (operationId) await manager.send.rollback(operationId);
   *   },
   *   availableMints: { 'https://mint.example.com': 5000, 'https://other.mint': 10000 },
   *   preferredMint: selectedMint,
   *   maxAmountSats: 10000,
   * });
   * ```
   */
  static async performPayment(options: PaymentOptions): Promise<PaymentResult> {
    const { createToken, recoverToken, availableMints, preferredMint, maxAmountSats, onScanRead } =
      options;

    log('Starting NFC payment flow...');

    // Validate that we have available mints
    const availableMintUrls = Object.keys(availableMints);
    if (availableMintUrls.length === 0) {
      throw new NfcError(
        'No mints available. Please add a mint to your wallet first.',
        'NO_AVAILABLE_MINTS'
      );
    }

    log(`Available mints: ${availableMintUrls.length}`);
    if (preferredMint) {
      log(`Preferred mint: ${preferredMint}`);
    }
    if (maxAmountSats !== undefined) {
      log(`Max amount: ${maxAmountSats} sats`);
    }

    // Pre-flight checks
    const supported = await this.isSupported();
    if (!supported) {
      throw new NfcError('NFC is not supported on this device', 'NOT_SUPPORTED');
    }

    const enabled = await this.isEnabled();
    if (!enabled) {
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

    try {
      // ===== PHASE 1: READ PAYMENT REQUEST =====
      log('Phase 1: Reading payment request...');

      // SELECT AID
      logDebug('SELECT NDEF Tag Application AID');
      let r = await sendApdu(SELECT_AID, 'SELECT AID');
      if (!r.ok) {
        throw new NfcError(
          `AID not accepted by tag (${getStatusMessage(r.sw)})`,
          'AID_SELECT_FAILED',
          r.sw
        );
      }

      // SELECT NDEF FILE
      logDebug('SELECT NDEF File (E104)');
      r = await sendApdu(SELECT_NDEF, 'SELECT NDEF');
      if (!r.ok) {
        throw new NfcError(
          `NDEF file not accessible (${getStatusMessage(r.sw)})`,
          'NDEF_SELECT_FAILED',
          r.sw
        );
      }

      // Read NLEN
      r = await sendApdu(READ_BINARY(0, 2), 'READ NLEN');
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

      // Read NDEF body
      let ndefBytes: number[] = [];

      if (nlen <= MAX_CHUNK_SIZE) {
        r = await sendApdu(READ_BINARY(2, nlen), 'READ NDEF');
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
          r = await sendApdu(READ_BINARY(offset, chunkSize), `READ chunk @${offset}`);
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

      // Check for empty payment request
      if (!paymentRequest || paymentRequest.length === 0) {
        throw new NfcError(
          'POS terminal returned empty payment request. The terminal may not be ready.',
          'EMPTY_PAYMENT_REQUEST'
        );
      }

      // Log scan to history regardless of payment outcome
      onScanRead?.(paymentRequest);

      logDebug(`Preview: ${paymentRequest.substring(0, 60)}...`);

      // ===== PHASE 2: DECODE AND VALIDATE =====
      log('Phase 2: Decoding payment request...');

      const { decodePaymentRequest } = await import('@cashu/cashu-ts');
      const decoded = decodePaymentRequest(paymentRequest);

      // Debug: Show decoded payment request
      Alert.alert('Decoded Payment Request', JSON.stringify(decoded, null, 2), [{ text: 'OK' }]);

      amount = decoded.amount || 0;
      const unit = decoded.unit || 'sat';
      const allowedMints = decoded.mints || [];

      log(`Payment request: ${amount} ${unit}`);
      logDebug(`Allowed mints: ${allowedMints.join(', ') || 'any'}`);

      if (amount <= 0) {
        throw new NfcError('Invalid payment amount', 'INVALID_AMOUNT');
      }

      // Check max amount limit
      if (maxAmountSats !== undefined && amount > maxAmountSats) {
        throw new NfcError(
          `Amount ${amount} sats exceeds your limit of ${maxAmountSats} sats`,
          'AMOUNT_EXCEEDED'
        );
      }

      // Select best mint (validates compatibility with POS and sufficient balance)
      const mintSelection = selectBestMint(allowedMints, availableMints, amount, preferredMint);
      selectedMint = mintSelection.mintUrl;
      log(`Selected mint: ${selectedMint} (balance: ${mintSelection.balance} sats)`);

      // ===== PHASE 3: CREATE TOKEN =====
      log('Phase 3: Creating token...');
      log(`Creating ${amount} sats from mint: ${selectedMint}`);

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
      logDebug(`Preview: ${createdToken.substring(0, 50)}...`);

      // ===== PHASE 4: WRITE TOKEN BACK =====
      log('Phase 4: Writing token back to POS...');

      // Re-select NDEF file (may be needed after callback delay)
      logDebug('Re-SELECT NDEF File for writing');
      r = await sendApdu(SELECT_NDEF, 'SELECT NDEF (write)');
      if (!r.ok) {
        throw new NfcError(
          `NDEF file not accessible for write (${getStatusMessage(r.sw)})`,
          'NDEF_SELECT_FAILED',
          r.sw
        );
      }

      // Build NDEF message
      const ndef = buildTextNdef(createdToken);
      const writeNlen = (ndef[0] << 8) | ndef[1];
      logDebug(`NDEF message: NLEN=${writeNlen}, total=${ndef.length} bytes`);

      // Write NLEN first
      r = await sendApdu(UPDATE_BINARY(0, [ndef[0], ndef[1]]), 'WRITE NLEN');
      if (!r.ok) {
        throw new NfcError(
          `Failed writing NLEN (${getStatusMessage(r.sw)})`,
          'WRITE_NLEN_FAILED',
          r.sw
        );
      }

      // Write body in chunks
      let offset = 2;
      const body = ndef.slice(2);
      const totalChunks = Math.ceil(body.length / MAX_CHUNK_SIZE);
      let chunkNum = 0;

      while (offset - 2 < body.length) {
        const chunk = body.slice(offset - 2, offset - 2 + MAX_CHUNK_SIZE);
        chunkNum++;
        logDebug(`Writing chunk ${chunkNum}/${totalChunks}: ${chunk.length} bytes`);

        r = await sendApdu(UPDATE_BINARY(offset, chunk), `WRITE chunk ${chunkNum}`);
        if (!r.ok) {
          throw new NfcError(
            `Failed writing chunk ${chunkNum} (${getStatusMessage(r.sw)})`,
            'WRITE_CHUNK_FAILED',
            r.sw
          );
        }
        offset += chunk.length;
      }

      log('NFC payment completed successfully!');

      return {
        paymentRequest,
        mintUrl: selectedMint,
        amount,
      };
    } catch (error) {
      // If we created a token but failed to write, attempt recovery
      if (createdToken) {
        logWarn('Write failed after token creation, attempting recovery...');
        try {
          await recoverToken(createdToken);
          log('Tokens recovered successfully');
        } catch (recoveryError) {
          logError('Token recovery failed:', recoveryError);
          logError('Unrecovered token:', createdToken);
        }
      }

      if (error instanceof NfcError) {
        throw error;
      }
      throw new NfcError(
        `NFC payment failed: ${error instanceof Error ? error.message : String(error)}`,
        'PAYMENT_FAILED'
      );
    } finally {
      logDebug('Releasing NFC technology...');
      try {
        await NfcManager.cancelTechnologyRequest();
      } catch (cleanupError) {
        logWarn('Failed to release NFC technology:', cleanupError);
      }
    }
  }
}
