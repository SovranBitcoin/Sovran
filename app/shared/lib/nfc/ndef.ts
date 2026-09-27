/**
 * NDEF encode/decode for Type 4 Tag: Text record writer, tolerant first-record reader.
 */

import { utf8ToBytes } from '@noble/hashes/utils.js';
import { NfcError } from './errors';
import { NDEF_TEXT_LANG, SHORT_RECORD_FLAG } from './constants';
import { nfcLog } from '../logger';

function toBytes(str: string): number[] {
  return Array.from(utf8ToBytes(str));
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

/** NDEF record header flag bits (NFC Forum NDEF 1.0 §3.2). */
const FLAG_CHUNK = 0x20;
const FLAG_ID_LENGTH = 0x08;
const TNF_MASK = 0x07;
const TNF_WELL_KNOWN = 0x01;
const TNF_MIME = 0x02;
const TNF_EXTERNAL = 0x04;
const RTD_TEXT = 0x54; // 'T'
const RTD_URI = 0x55; // 'U'

/**
 * URI RTD identifier codes (NFC Forum URI RTD 1.0 §3.2.2). The first payload
 * byte selects a prefix that is prepended to the rest of the payload; 0x00
 * means the payload is the whole URI.
 */
const URI_PREFIXES = [
  '',
  'http://www.',
  'https://www.',
  'http://',
  'https://',
  'tel:',
  'mailto:',
  'ftp://anonymous:anonymous@',
  'ftp://ftp.',
  'ftps://',
  'sftp://',
  'smb://',
  'nfs://',
  'ftp://',
  'dav://',
  'news:',
  'telnet://',
  'imap:',
  'rtsp://',
  'urn:',
  'pop:',
  'sip:',
  'sips:',
  'tftp:',
  'btspp://',
  'btl2cap://',
  'btgoep://',
  'tcpobex://',
  'irdaobex://',
  'file://',
  'urn:epc:id:',
  'urn:epc:tag:',
  'urn:epc:pat:',
  'urn:epc:raw:',
  'urn:epc:',
  'urn:nfc:',
];

interface NdefRecord {
  tnf: number;
  type: number[];
  payload: number[];
}

/**
 * Parse the first record of an NDEF message (no NLEN prefix). Later records
 * are ignored: a payment tag carries one payload, and a terminal that adds a
 * second record (an Android Application Record, say) must not break the read.
 */
function parseFirstRecord(ndef: number[]): NdefRecord {
  if (!ndef || ndef.length < 4) {
    throw new NfcError(
      `Invalid NDEF data: too short (${ndef?.length ?? 0} bytes)`,
      'INVALID_NDEF_FORMAT'
    );
  }
  const header = ndef[0];
  const typeLen = ndef[1];
  const isShortRecord = (header & SHORT_RECORD_FLAG) !== 0;
  const hasIdLength = (header & FLAG_ID_LENGTH) !== 0;
  const tnf = header & TNF_MASK;
  nfcLog.debug('nfc.ndef.parse', {
    header: `0x${header.toString(16)}`,
    typeLen,
    isShortRecord,
    hasIdLength,
    tnf,
  });

  if ((header & FLAG_CHUNK) !== 0) {
    throw new NfcError('Invalid NDEF: chunked records are not supported', 'INVALID_NDEF_FORMAT');
  }

  let cursor = 2;
  let payloadLen: number;
  if (isShortRecord) {
    payloadLen = ndef[2];
    cursor = 3;
  } else {
    if (ndef.length < 7) {
      throw new NfcError('Invalid NDEF: normal record header too short', 'INVALID_NDEF_FORMAT');
    }
    payloadLen = ((ndef[2] << 24) | (ndef[3] << 16) | (ndef[4] << 8) | ndef[5]) >>> 0;
    cursor = 6;
  }
  let idLen = 0;
  if (hasIdLength) {
    if (cursor >= ndef.length) {
      throw new NfcError('Invalid NDEF: ID length out of bounds', 'INVALID_NDEF_FORMAT');
    }
    idLen = ndef[cursor];
    cursor += 1;
  }
  nfcLog.debug('nfc.ndef.payload_info', { payloadLen, typeFieldStart: cursor, idLen });

  const typeStart = cursor;
  const idStart = typeStart + typeLen;
  const payloadStart = idStart + idLen;
  if (typeLen < 1 || payloadStart > ndef.length || payloadStart + payloadLen > ndef.length) {
    throw new NfcError(
      'Invalid NDEF: type, ID or payload length extends past the message',
      'INVALID_NDEF_FORMAT'
    );
  }
  return {
    tnf,
    type: ndef.slice(typeStart, idStart),
    payload: ndef.slice(payloadStart, payloadStart + payloadLen),
  };
}

/**
 * Decode the text a Type 4 tag carries in its first NDEF record.
 *
 * Accepts the shapes a payment terminal or tag plausibly writes:
 * - Text RTD (`T`): the NFC Forum text record, UTF-8 or UTF-16.
 * - URI RTD (`U`): identifier-code prefix expanded, so `cashu:…`,
 *   `bitcoin:?creq=…` and `https://…` all come back as the full string.
 * - MIME (TNF 2) and NFC-external (TNF 4) records: payload as UTF-8.
 *
 * Anything else raises `UNSUPPORTED_RECORD` with the type in the message.
 */
export function decodeNdefText(ndef: number[]): string {
  const record = parseFirstRecord(ndef);
  const typeText = String.fromCharCode(...record.type);

  if (record.tnf === TNF_WELL_KNOWN && record.type.length === 1 && record.type[0] === RTD_TEXT) {
    return decodeTextPayload(record.payload);
  }
  if (record.tnf === TNF_WELL_KNOWN && record.type.length === 1 && record.type[0] === RTD_URI) {
    if (record.payload.length < 1) {
      throw new NfcError('Invalid NDEF: URI record has no identifier code', 'INVALID_NDEF_FORMAT');
    }
    const prefix = URI_PREFIXES[record.payload[0]];
    if (prefix === undefined) {
      throw new NfcError(
        `Invalid NDEF: unknown URI identifier code 0x${record.payload[0].toString(16)}`,
        'INVALID_NDEF_FORMAT'
      );
    }
    const uri = prefix + new TextDecoder().decode(Uint8Array.from(record.payload.slice(1)));
    nfcLog.debug('nfc.ndef.decoded', {
      kind: 'uri',
      prefixCode: record.payload[0],
      chars: uri.length,
    });
    return uri;
  }
  if (record.tnf === TNF_MIME || record.tnf === TNF_EXTERNAL) {
    const text = new TextDecoder().decode(Uint8Array.from(record.payload));
    nfcLog.debug('nfc.ndef.decoded', {
      kind: record.tnf === TNF_MIME ? 'mime' : 'external',
      type: typeText,
      chars: text.length,
    });
    return text;
  }
  throw new NfcError(
    `Unsupported NDEF record (tnf=${record.tnf}, type=${JSON.stringify(typeText)})`,
    'UNSUPPORTED_RECORD'
  );
}

/** Text RTD payload: status byte, IANA language tag, then the text. */
function decodeTextPayload(payload: number[]): string {
  if (payload.length < 1) {
    throw new NfcError('Invalid NDEF: Text record has no status byte', 'INVALID_NDEF_FORMAT');
  }
  const status = payload[0];
  const langLen = status & 0x3f;
  const isUtf16 = (status & 0x80) !== 0;
  nfcLog.debug('nfc.ndef.text_record', { status: `0x${status.toString(16)}`, langLen, isUtf16 });

  if (payload.length < 1 + langLen) {
    throw new NfcError(
      `Invalid NDEF: language tag exceeds payload (langLen=${langLen}, payloadLen=${payload.length})`,
      'INVALID_NDEF_FORMAT'
    );
  }
  const textBytes = payload.slice(1 + langLen);
  const text = isUtf16
    ? decodeUtf16(textBytes)
    : new TextDecoder().decode(Uint8Array.from(textBytes));
  nfcLog.debug('nfc.ndef.decoded', {
    kind: 'text',
    textLen: textBytes.length,
    chars: text.length,
    encoding: isUtf16 ? 'utf16' : 'utf8',
  });
  return text;
}

/**
 * Decode UTF-16 bytes per the NFC Forum Text RTD: an optional BOM at the
 * head selects byte order (FE FF = BE, FF FE = LE); without a BOM the spec
 * defaults to big-endian. Code units are assembled directly in the tag's own
 * byte order, so neither endianness needs a byte-swap pass. A trailing odd
 * byte is not a code unit and is dropped.
 */
function decodeUtf16(bytes: number[]): string {
  const hasBeBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  const hasLeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const body = hasBeBom || hasLeBom ? bytes.slice(2) : bytes;
  let text = '';
  for (let i = 0; i + 1 < body.length; i += 2) {
    text += String.fromCharCode(
      hasLeBom ? body[i] | (body[i + 1] << 8) : (body[i] << 8) | body[i + 1]
    );
  }
  return text;
}

/** What a Type 4 Tag's Capability Container says about its NDEF file. */
export interface CapabilityContainer {
  /** Max bytes one READ BINARY may return (MLe). 0 means "not stated". */
  maxReadLength: number;
  /** Max bytes one UPDATE BINARY may carry (MLc). 0 means "not stated". */
  maxWriteLength: number;
  /** Size of the NDEF file including its 2-byte NLEN. */
  maxNdefFileSize: number;
  /** False when the write-access byte says the file is read-only. */
  writable: boolean;
}

/**
 * Parse the 15-byte Capability Container (NFC Forum Type 4 Tag 2.0 §5.1):
 * CCLEN(2) · mapping version(1) · MLe(2) · MLc(2) · NDEF File Control TLV
 * (T=0x04, L=0x06, file ID(2), max size(2), read access(1), write access(1)).
 * Returns null when the bytes are not a CC, so callers fall back to defaults
 * instead of trusting garbage.
 */
export function parseCapabilityContainer(bytes: number[]): CapabilityContainer | null {
  if (!bytes || bytes.length < 15) return null;
  const ccLen = (bytes[0] << 8) | bytes[1];
  if (ccLen < 15) return null;
  if (bytes[7] !== 0x04 || bytes[8] < 0x06) return null;
  return {
    maxReadLength: (bytes[3] << 8) | bytes[4],
    maxWriteLength: (bytes[5] << 8) | bytes[6],
    maxNdefFileSize: (bytes[11] << 8) | bytes[12],
    writable: bytes[14] === 0x00,
  };
}
