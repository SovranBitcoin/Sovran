/**
 * Low-level APDU transport for IsoDep (Type 4 Tag) communication.
 */

import { Buffer } from 'buffer';
import NfcManager from 'react-native-nfc-manager';
import { NfcError } from './errors';
import { STATUS_CODES, STATUS_OK } from './constants';
import { logDebug, logError } from './logger';

export interface ApduResponse {
  ok: boolean;
  raw: number[];
  payload: number[];
  sw: string;
}

export function hex(bytes: number[]): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

export function getStatusMessage(sw: string): string {
  return STATUS_CODES[sw.toLowerCase()] ?? `Unknown status: ${sw}`;
}

export async function sendApdu(command: number[], label?: string): Promise<ApduResponse> {
  const cmdHex = hex(command);
  logDebug(`>> APDU${label ? ` [${label}]` : ''}: ${cmdHex}`);

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

    logDebug(`<< Response: ${hexResp} (SW: ${sw} - ${getStatusMessage(sw)})`);

    return {
      ok,
      raw: response,
      payload: response.slice(0, -2),
      sw,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStr = errorMessage || 'Unknown error';
    logError('APDU transceive failed:', errorStr);

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

    if (error instanceof NfcError) throw error;
    throw new NfcError(`APDU communication failed: ${errorStr}`, 'TRANSCEIVE_FAILED');
  }
}
