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
import { readCapabilityContainer, selectNdefApplication, selectNdefFile } from './apdu';
import { buildTextNdef } from './ndef';
import { writeNdefTextRecord } from './write';
import { withSession } from './session';
import { nfcLog } from '../logger';
import { nfcErrorFields } from './adapter';

export async function writeTokenToNFC(token: string): Promise<void> {
  nfcLog.info('nfc.write.start', { tokenLength: token.length });

  // Support/enabled preflight (typed NOT_SUPPORTED / NOT_ENABLED throws) is
  // owned by acquireSession inside withSession.
  try {
    await withSession(async () => {
      await selectNdefApplication();
      // A passive tag has a fixed NDEF file: learn its size and write limits
      // first, so a token that cannot fit fails before NLEN is zeroed rather
      // than half-way through, leaving the tag unreadable. (The POS adapter
      // skips this: a terminal's file is large and its clock is running.)
      const cc = await readCapabilityContainer();
      await selectNdefFile();
      const ndefLength = buildTextNdef(token).length;
      if (cc && !cc.writable) {
        throw new NfcError('This tag is read-only.', 'TAG_READ_ONLY');
      }
      if (cc && cc.maxNdefFileSize > 0 && ndefLength > cc.maxNdefFileSize) {
        throw new NfcError(
          `This tag holds ${cc.maxNdefFileSize} bytes; the token needs ${ndefLength}.`,
          'TAG_TOO_SMALL'
        );
      }
      await writeNdefTextRecord(token, { chunkSize: cc?.maxWriteLength });
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
