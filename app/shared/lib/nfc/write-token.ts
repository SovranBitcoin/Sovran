/**
 * Write a Cashu token to an NFC tag (e.g. for P2P sharing).
 *
 * One-shot session via `withSession` from `./session.ts`: stale-prelude,
 * acquire, release-on-throw, and release-on-success are owned by the deep
 * module. This file orchestrates the AID/NDEF select sequence and delegates
 * the wire-level write to `writeNdefTextRecord`, the same helper the
 * colada adapter uses.
 *
 * Throws `NfcError` on any failure; callers should match on `error.code`
 * (e.g. `'TAG_LOST'`, `'TRANSCEIVE_FAILED'`).
 */

import { NfcError, isUserCancelError } from './errors';
import { SELECT_AID, SELECT_NDEF } from './constants';
import { sendApdu, getStatusMessage } from './apdu';
import { writeNdefTextRecord } from './write';
import { withSession } from './session';
import { nfcLog } from '../logger';

function nfcErrorFields(error: unknown): Record<string, unknown> {
  return {
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof NfcError ? error.code : undefined,
    statusWord: error instanceof NfcError ? error.statusWord : undefined,
  };
}

export async function writeTokenToNFC(token: string): Promise<void> {
  nfcLog.info('nfc.write.start', { tokenLength: token.length });

  // Support/enabled preflight (typed NOT_SUPPORTED / NOT_ENABLED throws) is
  // owned by acquireSession inside withSession.
  try {
    await withSession(async () => {
      let r = await sendApdu(SELECT_AID, 'SELECT AID');
      if (!r.ok) {
        throw new NfcError(
          `AID not accepted (${getStatusMessage(r.sw)})`,
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

      await writeNdefTextRecord(token);
      nfcLog.info('nfc.write.success', { tokenLength: token.length });
    });
  } catch (error) {
    // Preserve UserCancel so the caller can distinguish a user-initiated
    // close from a real failure — wrapping it as 'WRITE_FAILED' would
    // trigger an error popup for a normal cancel.
    if (isUserCancelError(error)) {
      nfcLog.debug('nfc.write.cancelled', { tokenLength: token.length });
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    nfcLog.error('nfc.write.failed', {
      tokenLength: token.length,
      ...nfcErrorFields(error),
    });
    if (error instanceof NfcError) throw error;
    throw new NfcError(message, 'WRITE_FAILED');
  }
}
