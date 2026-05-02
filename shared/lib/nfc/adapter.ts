/**
 * NfcIOAdapter — platform implementation for coco-payment-ux NFC flows.
 *
 * Wraps APDU/NDEF primitives into the adapter interface that the payment
 * machine consumes. Low-level transport stays in this module; policy and
 * orchestration live in coco-payment-ux.
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';

import type { NfcIOAdapter } from 'coco-payment-ux';

import { NfcError } from './errors';
import { SELECT_AID, SELECT_NDEF, readBinary, MAX_CHUNK_SIZE } from './constants';
import { sendApdu, getStatusMessage } from './apdu';
import { decodeTextRecord } from './ndef';
import { isNfcSupported, isNfcEnabled } from './status';
import { writeNdefTextRecord } from './write';
import { nfcLog } from '../logger';

export function createNfcAdapter(): NfcIOAdapter {
  return {
    async readPaymentRequest(): Promise<string> {
      nfcLog.info('nfc.adapter.read_start');

      await NfcManager.requestTechnology(NfcTech.IsoDep);
      nfcLog.info('nfc.adapter.isodep_acquired');

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
      nfcLog.debug('nfc.adapter.nlen', { nlen });

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
        nfcLog.debug('nfc.adapter.read_chunked', { nlen });
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

      const text = decodeTextRecord(ndefBytes);
      nfcLog.info('nfc.adapter.read_complete', { chars: text.length });

      if (!text || text.length === 0) {
        throw new NfcError('POS terminal returned empty payment request.', 'EMPTY_PAYMENT_REQUEST');
      }

      return text;
    },

    async writeToken(token: string): Promise<void> {
      nfcLog.info('nfc.adapter.write_start');

      const r = await sendApdu(SELECT_NDEF, 'SELECT NDEF (write)');
      if (!r.ok) {
        throw new NfcError(
          `NDEF file not accessible for write (${getStatusMessage(r.sw)})`,
          'NDEF_SELECT_FAILED',
          r.sw
        );
      }

      await writeNdefTextRecord(token);
      nfcLog.info('nfc.adapter.write_success');
    },

    async releaseSession(): Promise<void> {
      try {
        await NfcManager.cancelTechnologyRequest();
        nfcLog.info('nfc.adapter.session_released');
      } catch (e) {
        nfcLog.warn('nfc.adapter.release_failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    async isAvailable(): Promise<boolean> {
      const supported = await isNfcSupported();
      if (!supported) return false;
      return isNfcEnabled();
    },
  };
}
