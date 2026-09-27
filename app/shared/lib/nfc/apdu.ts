/**
 * Low-level APDU transport for IsoDep (Type 4 Tag) communication.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import NfcManager from 'react-native-nfc-manager';
import { NfcError } from './errors';
import {
  SELECT_AID,
  SELECT_CC,
  SELECT_NDEF,
  STATUS_CODES,
  STATUS_OK,
  readBinary,
} from './constants';
import { parseCapabilityContainer, type CapabilityContainer } from './ndef';
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
  // APDU bodies can contain bearer tokens; encoding them as hex does not make
  // them safe to log and bypasses the text token redactor.
  nfcLog.debug('nfc.apdu.send', { label, bytes: command.length });

  try {
    if (!NfcManager.isoDepHandler) {
      throw new NfcError('IsoDep handler not available', 'HANDLER_NOT_AVAILABLE');
    }

    const response = await NfcManager.isoDepHandler.transceive(command);

    if (!response || response.length < 2) {
      throw new NfcError('Invalid or empty response from NFC device', 'INVALID_RESPONSE');
    }

    const sw = hex(response.slice(-2));
    const ok = sw.toLowerCase() === STATUS_OK.toLowerCase();

    nfcLog.debug('nfc.apdu.response', { bytes: response.length, sw, status: getStatusMessage(sw) });

    return {
      ok,
      raw: response,
      payload: response.slice(0, -2),
      sw,
    };
  } catch (error) {
    if (error instanceof NfcError) throw error;
    const errorStr = (error instanceof Error ? error.message : String(error)) || 'Unknown error';
    const mapped = mapTransceiveError(errorStr);
    nfcLog.error('nfc.apdu.transceive_failed', { code: mapped.code });
    throw mapped;
  }
}

/** SELECT the NDEF Tag Application by AID. */
export async function selectNdefApplication(): Promise<void> {
  const r = await sendApdu(SELECT_AID, 'SELECT AID');
  if (!r.ok) {
    throw new NfcError(
      `AID not accepted by tag (${getStatusMessage(r.sw)})`,
      'AID_SELECT_FAILED',
      r.sw
    );
  }
}

/** SELECT the NDEF file (E104) inside an already-selected NDEF application. */
export async function selectNdefFile(): Promise<void> {
  const r = await sendApdu(SELECT_NDEF, 'SELECT NDEF');
  if (!r.ok) {
    throw new NfcError(
      `NDEF file not accessible (${getStatusMessage(r.sw)})`,
      'NDEF_SELECT_FAILED',
      r.sw
    );
  }
}

/**
 * The Type 4 Tag open ceremony shared by the reader and writer: SELECT the
 * NDEF application (AID), then SELECT its NDEF file. Throws a typed NfcError
 * naming the step that failed.
 */
export async function selectNdefApp(): Promise<void> {
  await selectNdefApplication();
  await selectNdefFile();
}

/**
 * Read the Capability Container (E103). Call between `selectNdefApplication`
 * and `selectNdefFile`. Best-effort: a tag or terminal that does not serve a
 * CC, or serves one this parser does not recognise, yields null and the
 * caller proceeds with its defaults — the CC is advice about limits, never a
 * gate on the transaction itself.
 */
export async function readCapabilityContainer(): Promise<CapabilityContainer | null> {
  const selected = await sendApdu(SELECT_CC, 'SELECT CC');
  if (!selected.ok) {
    nfcLog.debug('nfc.cc.unavailable', { step: 'select', sw: selected.sw });
    return null;
  }
  const read = await sendApdu(readBinary(0, 15), 'READ CC');
  if (!read.ok) {
    nfcLog.debug('nfc.cc.unavailable', { step: 'read', sw: read.sw });
    return null;
  }
  const cc = parseCapabilityContainer(read.payload);
  nfcLog.debug('nfc.cc.read', { parsed: !!cc, ...(cc ?? {}) });
  return cc;
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
  return new NfcError('NFC communication failed. Please try again.', 'TRANSCEIVE_FAILED');
}
