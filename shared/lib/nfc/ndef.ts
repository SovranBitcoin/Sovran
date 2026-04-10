/**
 * NDEF Text record encode/decode for Type 4 Tag.
 */

import { Buffer } from 'buffer';
import { NfcError } from './errors';
import { SHORT_RECORD_FLAG } from './constants';
import { nfcLog } from '../logger';

function toBytes(str: string): number[] {
  return Array.from(Buffer.from(str, 'utf8'));
}

/**
 * Build NDEF Text record (Short or Normal format).
 */
export function buildTextNdef(text: string): number[] {
  const lang = 'en';
  const langBytes = toBytes(lang);
  const textBytes = toBytes(text);
  const payload = [langBytes.length, ...langBytes, ...textBytes];

  let recordHeader: number[];

  if (payload.length <= 255) {
    nfcLog.debug('nfc.ndef.build_short_record', { payloadBytes: payload.length });
    recordHeader = [
      0xd1,
      0x01,
      payload.length,
      0x54, // MB=1, ME=1, SR=1, TNF=1, type 'T'
      ...payload,
    ];
  } else {
    nfcLog.debug('nfc.ndef.build_normal_record', { payloadBytes: payload.length });
    const len = payload.length;
    recordHeader = [
      0xc1,
      0x01,
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      0x54,
      ...payload,
    ];
  }

  const nlen = recordHeader.length;
  nfcLog.debug('nfc.ndef.build_complete', { totalBytes: nlen + 2, nlen });
  return [(nlen >> 8) & 0xff, nlen & 0xff, ...recordHeader];
}

/**
 * Decode NDEF Text record from raw bytes.
 */
export function decodeTextRecord(ndef: number[]): string {
  if (!ndef || ndef.length < 4) {
    throw new NfcError(
      `Invalid NDEF data: too short (${ndef?.length ?? 0} bytes)`,
      'INVALID_NDEF_FORMAT'
    );
  }

  const header = ndef[0];
  const typeLen = ndef[1];
  const isShortRecord = (header & SHORT_RECORD_FLAG) !== 0;

  nfcLog.debug('nfc.ndef.parse', { header: `0x${header.toString(16)}`, typeLen, isShortRecord });

  const tnf = header & 0x07;
  if (tnf !== 0x01) nfcLog.warn('nfc.ndef.unexpected_tnf', { tnf, expected: 1 });

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

  nfcLog.debug('nfc.ndef.payload_info', { payloadLen, typeFieldStart });

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
  nfcLog.debug('nfc.ndef.text_record', { status: `0x${status.toString(16)}`, langLen, isUtf16 });
  if (isUtf16) nfcLog.warn('nfc.ndef.utf16_detected');

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
  nfcLog.debug('nfc.ndef.decoded', { textLen, chars: text.length });
  return text;
}
