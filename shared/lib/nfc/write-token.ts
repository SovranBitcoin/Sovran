/**
 * Write a Cashu token to an NFC tag (e.g. for P2P sharing).
 *
 * Standalone from the POS payment flow: this owns the IsoDep session
 * lifecycle and AID/NDEF selection itself, then delegates the wire-level
 * write to the canonical `writeNdefTextRecord` helper that the
 * coco-payment-ux adapter also uses.
 *
 * Throws `NfcError` on any failure; callers should match on `error.code`
 * (e.g. `'TAG_LOST'`, `'TRANSCEIVE_FAILED'`).
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { NfcError } from './errors';
import { SELECT_AID, SELECT_NDEF } from './constants';
import { sendApdu, getStatusMessage } from './apdu';
import { isNfcSupported, isNfcEnabled } from './status';
import { writeNdefTextRecord } from './write';
import { nfcLog } from '../logger';

export async function writeTokenToNFC(token: string): Promise<void> {
  nfcLog.info('nfc.write.start');

  if (!(await isNfcSupported())) {
    throw new NfcError('NFC is not supported on this device', 'NOT_SUPPORTED');
  }
  if (!(await isNfcEnabled())) {
    throw new NfcError('NFC is disabled', 'NOT_ENABLED');
  }

  try {
    // Cancel any stale NFC session from a previous attempt that wasn't
    // cleaned up (e.g. the sheet dismiss animation blocked the native NFC
    // modal from appearing and the user never got to cancel it).
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {
      // No active session — expected path.
    }

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

    await writeNdefTextRecord(token);
    nfcLog.info('nfc.write.success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    nfcLog.error('nfc.write.failed', { error: message });
    if (error instanceof NfcError) throw error;
    throw new NfcError(message, 'WRITE_FAILED');
  } finally {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch (e) {
      nfcLog.warn('nfc.write.release_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
