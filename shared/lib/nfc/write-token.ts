/**
 * Write a Cashu token to an NFC tag (e.g. for P2P sharing).
 * Standalone from the POS payment flow.
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { NfcError } from './errors';
import { SELECT_AID, SELECT_NDEF, updateBinary, MAX_CHUNK_SIZE } from './constants';
import { sendApdu, getStatusMessage } from './apdu';
import { buildTextNdef } from './ndef';
import { isNfcSupported, isNfcEnabled } from './status';
import { nfcLog } from '../logger';

export interface NfcTokenWriteResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export async function writeTokenToNFC(token: string): Promise<NfcTokenWriteResult> {
  nfcLog.info('nfc.write.start');

  if (!(await isNfcSupported())) {
    return {
      success: false,
      errorCode: 'NOT_SUPPORTED',
      errorMessage: 'NFC is not supported on this device',
    };
  }
  if (!(await isNfcEnabled())) {
    return { success: false, errorCode: 'NOT_ENABLED', errorMessage: 'NFC is disabled' };
  }

  try {
    await NfcManager.requestTechnology(NfcTech.IsoDep);
    nfcLog.info('nfc.write.isodep_acquired');

    let r = await sendApdu(SELECT_AID, 'SELECT AID');
    if (!r.ok) {
      throw new NfcError(`AID not accepted (${getStatusMessage(r.sw)})`, 'AID_SELECT_FAILED', r.sw);
    }

    r = await sendApdu(SELECT_NDEF, 'SELECT NDEF');
    if (!r.ok) {
      throw new NfcError(
        `NDEF file not accessible (${getStatusMessage(r.sw)})`,
        'NDEF_SELECT_FAILED',
        r.sw
      );
    }

    const ndef = buildTextNdef(token);
    nfcLog.debug('nfc.write.ndef_message', {
      nlen: (ndef[0] << 8) | ndef[1],
      totalBytes: ndef.length,
    });

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
      nfcLog.debug('nfc.write.chunk', { chunk: chunkNum + 1, totalChunks, bytes: chunk.length });
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

    nfcLog.info('nfc.write.success');
    return { success: true };
  } catch (error) {
    nfcLog.error('nfc.write.failed', { error });
    if (error instanceof NfcError) {
      return { success: false, errorCode: error.code, errorMessage: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, errorCode: 'WRITE_FAILED', errorMessage: message };
  } finally {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch (e) {
      nfcLog.warn('nfc.write.release_failed', { error: e });
    }
  }
}
