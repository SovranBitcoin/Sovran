/**
 * Canonical Type 4 Tag NDEF write.
 *
 * Both the standalone token writer and the colada adapter route
 * through this helper so the wire-level write protocol is implemented once.
 *
 * Caller must hold an active IsoDep session AND have already issued
 * SELECT_NDEF — this helper does not manage session lifecycle or AID/file
 * selection.
 */

import { sendApdu, getStatusMessage } from './apdu';
import { buildTextNdef } from './ndef';
import { updateBinary, MAX_CHUNK_SIZE } from './constants';
import { NfcError } from './errors';
import { nfcLog } from '../logger';

/**
 * Write a UTF-8 text payload to the currently selected NDEF file using the
 * NFC Forum Type 4 Tag three-phase NLEN protocol:
 *
 *   1. Zero NLEN — signals readers the content is being updated.
 *   2. Write the NDEF body in `MAX_CHUNK_SIZE` chunks.
 *   3. Set the final NLEN — makes the new content visible.
 *
 * Writing the final NLEN before the chunks (the historical bug in the
 * standalone writer) leaves the tag readable as garbage if the write is
 * interrupted between phases.
 *
 * Throws `NfcError` on any APDU failure.
 */
export async function writeNdefTextRecord(text: string): Promise<void> {
  const ndef = buildTextNdef(text);
  nfcLog.debug('nfc.ndef.write_start', {
    nlen: (ndef[0] << 8) | ndef[1],
    totalBytes: ndef.length,
  });

  let r = await sendApdu(updateBinary(0, [0x00, 0x00]), 'ZERO NLEN');
  if (!r.ok) {
    throw new NfcError(
      `Failed zeroing NLEN (${getStatusMessage(r.sw)})`,
      'WRITE_NLEN_FAILED',
      r.sw
    );
  }

  const body = ndef.slice(2);
  let offset = 2;
  const totalChunks = Math.ceil(body.length / MAX_CHUNK_SIZE);
  for (let chunkNum = 0; offset - 2 < body.length; chunkNum++) {
    const chunk = body.slice(offset - 2, offset - 2 + MAX_CHUNK_SIZE);
    nfcLog.debug('nfc.ndef.write_chunk', {
      chunk: chunkNum + 1,
      totalChunks,
      bytes: chunk.length,
    });
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

  r = await sendApdu(updateBinary(0, [ndef[0], ndef[1]]), 'SET NLEN');
  if (!r.ok) {
    throw new NfcError(
      `Failed writing final NLEN (${getStatusMessage(r.sw)})`,
      'WRITE_NLEN_FAILED',
      r.sw
    );
  }
}
