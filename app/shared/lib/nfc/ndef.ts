/**
 * NDEF Text record encode/decode for Type 4 Tag.
 */

import { Buffer } from 'buffer';
import { NfcError } from './errors';
import { NDEF_TEXT_LANG, SHORT_RECORD_FLAG } from './constants';
import { nfcLog } from '../logger';

function toBytes(str: string): number[] {
  return Array.from(Buffer.from(str, 'utf8'));
}

/**
 * Build NDEF Text record (Short or Normal format).
 *
 * Text is encoded UTF-8 per the NFC Forum Text RTD; `lang` defaults to
 * `NDEF_TEXT_LANG` ('en') and must be ≤63 ASCII bytes (status byte limit).
 */
export function buildTextNdef(text: string, opts?: { lang?: string }): number[] {
  const lang = opts?.lang ?? NDEF_TEXT_LANG;
  const langBytes = toBytes(lang);
  if (langBytes.length > 63) {
    throw new NfcError(
      `Language tag too long (${langBytes.length} bytes, max 63)`,
      'INVALID_LANG_TAG'
    );
  }
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

  if (typeLen !== 1 || typeFieldStart + typeLen > ndef.length) {
    throw new NfcError(
      `Invalid NDEF: Text record type length must be 1 (received ${typeLen})`,
      'INVALID_NDEF_FORMAT'
    );
  }

  const type = ndef[typeFieldStart];
  if (type !== 0x54) {
    throw new NfcError(
      `Not a Text record (type=0x${type.toString(16)}, expected 0x54 'T')`,
      'NOT_TEXT_RECORD'
    );
  }

  const payloadStart = typeFieldStart + typeLen;
  if (payloadStart >= ndef.length || payloadStart + payloadLen > ndef.length) {
    throw new NfcError('Invalid NDEF: payload start out of bounds', 'INVALID_NDEF_FORMAT');
  }

  const status = ndef[payloadStart];
  const langLen = status & 0x3f;
  const isUtf16 = (status & 0x80) !== 0;
  nfcLog.debug('nfc.ndef.text_record', { status: `0x${status.toString(16)}`, langLen, isUtf16 });

  if (payloadLen < 1 + langLen) {
    throw new NfcError(
      `Invalid NDEF: language tag exceeds payload (langLen=${langLen}, payloadLen=${payloadLen})`,
      'INVALID_NDEF_FORMAT'
    );
  }

  const textStart = payloadStart + 1 + langLen;
  const textLen = payloadLen - 1 - langLen;

  if (textStart + textLen > ndef.length) {
    throw new NfcError(
      `Invalid NDEF: text data out of bounds (textStart=${textStart}, textLen=${textLen}, ndefLen=${ndef.length})`,
      'INVALID_NDEF_FORMAT'
    );
  }

  const textBytes = ndef.slice(textStart, textStart + textLen);
  const text = isUtf16 ? decodeUtf16(textBytes) : Buffer.from(textBytes).toString('utf8');
  nfcLog.debug('nfc.ndef.decoded', {
    textLen,
    chars: text.length,
    encoding: isUtf16 ? 'utf16' : 'utf8',
  });
  return text;
}

/**
 * Decode UTF-16 bytes per the NFC Forum Text RTD: an optional BOM at the
 * head selects byte order (FE FF = BE, FF FE = LE); without a BOM the spec
 * defaults to big-endian. Node's Buffer only decodes UTF-16LE natively, so
 * BE input is byte-swapped in place before decode.
 */
function decodeUtf16(bytes: number[]): string {
  const hasBeBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  const hasLeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const isBigEndian = hasBeBom || (!hasLeBom && !hasBeBom);
  const stripped = hasBeBom || hasLeBom ? bytes.slice(2) : bytes;
  if (isBigEndian) {
    const swapped = Buffer.from(stripped);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
    }
    return swapped.toString('utf16le');
  }
  return Buffer.from(stripped).toString('utf16le');
}
