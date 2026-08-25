/**
 * Low-level APDU transport for IsoDep (Type 4 Tag) communication.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import NfcManager from 'react-native-nfc-manager';
import { NfcError } from './errors';
import { SELECT_AID, SELECT_NDEF, STATUS_CODES, STATUS_OK } from './constants';
import { nfcLog } from '../logger';

interface ApduResponse {
  ok: boolean;
  raw: number[];
  payload: number[];
  sw: string;
}

function hex(bytes: number[]): string {
  return bytesToHex(Uint8Array.from(bytes)).toUpperCase();
}

export function getStatusMessage(sw: string): string {
  return STATUS_CODES[sw.toLowerCase()] ?? `Unknown status: ${sw}`;
}

export async function sendApdu(command: number[], label?: string): Promise<ApduResponse> {
  const cmdHex = hex(command);
  nfcLog.debug('nfc.apdu.send', { label, command: cmdHex });

  try {
    if (!NfcManager.isoDepHandler) {
      throw new NfcError('IsoDep handler not available', 'HANDLER_NOT_AVAILABLE');
    }

    const response = await NfcManager.isoDepHandler.transceive(command);

    if (!response || response.length < 2) {
      throw new NfcError('Invalid or empty response from NFC device', 'INVALID_RESPONSE');
    }

    const hexResp = hex(response);
    const sw = hexResp.slice(-4);
    const ok = sw.toLowerCase() === STATUS_OK.toLowerCase();

    nfcLog.debug('nfc.apdu.response', { response: hexResp, sw, status: getStatusMessage(sw) });

    return {
      ok,
      raw: response,
      payload: response.slice(0, -2),
      sw,
    };
  } catch (error) {
    if (error instanceof NfcError) throw error;
    const errorStr = (error instanceof Error ? error.message : String(error)) || 'Unknown error';
    nfcLog.error('nfc.apdu.transceive_failed', { error: errorStr });
    throw mapTransceiveError(errorStr);
  }
}

/**
 * The Type 4 Tag open ceremony shared by the reader and writer: SELECT the
 * NDEF application (AID), then SELECT its NDEF file. Throws a typed NfcError
 * naming the step that failed.
 */
export async function selectNdefApp(): Promise<void> {
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
}

/**
 * Map a `react-native-nfc-manager` transceive error message to an NfcError.
 *
 * The native module surfaces these failures as plain strings (Android:
 * `"transceive fail: " + ex` from `NfcManager.java`; iOS: NSError localized
 * descriptions). There is no error code on the JS side — substring matching
 * the message is the only available signal. Centralised here so the
 * upstream-string fragility lives in one named place; if RN-NFC-Manager ever
 * exposes structured error codes, this is the seam to swap.
 */
function mapTransceiveError(message: string): NfcError {
  if (message.includes('Tag was lost') || message.includes('TagLost')) {
    return new NfcError(
      'NFC connection lost. Please hold your device steady near the terminal.',
      'TAG_LOST'
    );
  }
  if (message.includes('Transceive failed') || message === '' || message === 'undefined') {
    return new NfcError(
      'NFC communication failed. Please try again and hold steady.',
      'TRANSCEIVE_FAILED'
    );
  }
  return new NfcError(`APDU communication failed: ${message}`, 'TRANSCEIVE_FAILED');
}
