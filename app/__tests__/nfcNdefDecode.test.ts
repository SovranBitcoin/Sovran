import { Buffer } from 'buffer';

import { buildTextNdef, decodeTextRecord } from '@/shared/lib/nfc/ndef';

jest.mock('@/shared/lib/logger', () => ({
  nfcLog: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

function utf16beBytes(text: string): number[] {
  const out: number[] = [];
  for (const codeUnit of Buffer.from(text, 'utf16le')) {
    out.push(codeUnit);
  }
  // Buffer.from(text, 'utf16le') yields LE byte pairs; swap to BE.
  for (let i = 0; i + 1 < out.length; i += 2) {
    const tmp = out[i];
    out[i] = out[i + 1];
    out[i + 1] = tmp;
  }
  return out;
}

function buildRecordBytes(opts: {
  textBytes: number[];
  langBytes: number[];
  isUtf16: boolean;
}): number[] {
  const { textBytes, langBytes, isUtf16 } = opts;
  const status = (isUtf16 ? 0x80 : 0) | (langBytes.length & 0x3f);
  const payload = [status, ...langBytes, ...textBytes];
  // Short record: payload <= 255. decodeTextRecord expects no NLEN prefix.
  return [0xd1, 0x01, payload.length, 0x54, ...payload];
}

describe('NFC NDEF Text record (audit 48.json F-007 / F-012)', () => {
  it('round-trips UTF-8 text via buildTextNdef + decodeTextRecord', () => {
    const ndef = buildTextNdef('hello world');
    // Strip the leading 2-byte NLEN that buildTextNdef prepends.
    const recordBytes = ndef.slice(2);
    expect(decodeTextRecord(recordBytes)).toBe('hello world');
  });

  it('round-trips long UTF-8 text using the normal-record format', () => {
    const longText = 'cashu' + 'A'.repeat(300);
    const ndef = buildTextNdef(longText);
    const recordBytes = ndef.slice(2);
    expect(decodeTextRecord(recordBytes)).toBe(longText);
  });

  it('switches to a normal record at the exact 256-byte payload boundary', () => {
    // status + "en" + 253 ASCII bytes = a 256-byte payload.
    const text = 'x'.repeat(253);
    const recordBytes = buildTextNdef(text).slice(2);

    expect(recordBytes[0]).toBe(0xc1);
    expect(decodeTextRecord(recordBytes)).toBe(text);
  });

  it('decodes UTF-16 with no BOM as big-endian per NDEF Text RTD (F-007)', () => {
    const recordBytes = buildRecordBytes({
      textBytes: utf16beBytes('héllo'),
      langBytes: Array.from(Buffer.from('en', 'utf8')),
      isUtf16: true,
    });
    expect(decodeTextRecord(recordBytes)).toBe('héllo');
  });

  it('decodes UTF-16 with BE BOM correctly', () => {
    const recordBytes = buildRecordBytes({
      textBytes: [0xfe, 0xff, ...utf16beBytes('Σύνορα')],
      langBytes: Array.from(Buffer.from('en', 'utf8')),
      isUtf16: true,
    });
    expect(decodeTextRecord(recordBytes)).toBe('Σύνορα');
  });

  it('decodes UTF-16 with LE BOM correctly', () => {
    const leBytes = Array.from(Buffer.from('日本語', 'utf16le'));
    const recordBytes = buildRecordBytes({
      textBytes: [0xff, 0xfe, ...leBytes],
      langBytes: Array.from(Buffer.from('en', 'utf8')),
      isUtf16: true,
    });
    expect(decodeTextRecord(recordBytes)).toBe('日本語');
  });

  it('honours an explicit language tag in buildTextNdef (F-012)', () => {
    const ndef = buildTextNdef('bonjour', { lang: 'fr' });
    const recordBytes = ndef.slice(2);
    // The status byte sits at payloadStart; for short records that's index 4.
    // status = (utf16<<7) | langLen → langLen 2, utf16 0 ⇒ 0x02.
    expect(recordBytes[4]).toBe(0x02);
    // Language bytes follow immediately.
    expect(recordBytes[5]).toBe('f'.charCodeAt(0));
    expect(recordBytes[6]).toBe('r'.charCodeAt(0));
    expect(decodeTextRecord(recordBytes)).toBe('bonjour');
  });

  it('rejects a normal-record header shorter than seven bytes', () => {
    expect(() => decodeTextRecord([0xc1, 0x01, 0, 0, 0, 1])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('rejects declared type or payload lengths that extend past the input', () => {
    expect(() => decodeTextRecord([0xd1, 0x04, 0x01, 0x54, 0])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
    expect(() => decodeTextRecord([0xd1, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('rejects a language length larger than the declared payload', () => {
    expect(() => decodeTextRecord([0xd1, 0x01, 0x01, 0x54, 0x3f])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('rejects non-Text records and overlong language tags', () => {
    expect(() => decodeTextRecord([0xd1, 0x01, 0x01, 0x55, 0])).toThrow(
      expect.objectContaining({ code: 'NOT_TEXT_RECORD' })
    );
    expect(() => buildTextNdef('hello', { lang: 'x'.repeat(64) })).toThrow(
      expect.objectContaining({ code: 'INVALID_LANG_TAG' })
    );
  });
});
