import { Buffer } from 'buffer';

import { buildTextNdef, decodeNdefText, parseCapabilityContainer } from '@/shared/lib/nfc/ndef';

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
  // Short record: payload <= 255. decodeNdefText expects no NLEN prefix.
  return [0xd1, 0x01, payload.length, 0x54, ...payload];
}

describe('NFC NDEF Text record (audit 48.json F-007 / F-012)', () => {
  it('round-trips UTF-8 text via buildTextNdef + decodeNdefText', () => {
    const ndef = buildTextNdef('hello world');
    // Strip the leading 2-byte NLEN that buildTextNdef prepends.
    const recordBytes = ndef.slice(2);
    expect(decodeNdefText(recordBytes)).toBe('hello world');
  });

  it('round-trips long UTF-8 text using the normal-record format', () => {
    const longText = 'cashu' + 'A'.repeat(300);
    const ndef = buildTextNdef(longText);
    const recordBytes = ndef.slice(2);
    expect(decodeNdefText(recordBytes)).toBe(longText);
  });

  it('switches to a normal record at the exact 256-byte payload boundary', () => {
    // status + "en" + 253 ASCII bytes = a 256-byte payload.
    const text = 'x'.repeat(253);
    const recordBytes = buildTextNdef(text).slice(2);

    expect(recordBytes[0]).toBe(0xc1);
    expect(decodeNdefText(recordBytes)).toBe(text);
  });

  it('decodes UTF-16 with no BOM as big-endian per NDEF Text RTD (F-007)', () => {
    const recordBytes = buildRecordBytes({
      textBytes: utf16beBytes('héllo'),
      langBytes: Array.from(Buffer.from('en', 'utf8')),
      isUtf16: true,
    });
    expect(decodeNdefText(recordBytes)).toBe('héllo');
  });

  it('decodes UTF-16 with BE BOM correctly', () => {
    const recordBytes = buildRecordBytes({
      textBytes: [0xfe, 0xff, ...utf16beBytes('Σύνορα')],
      langBytes: Array.from(Buffer.from('en', 'utf8')),
      isUtf16: true,
    });
    expect(decodeNdefText(recordBytes)).toBe('Σύνορα');
  });

  it('decodes UTF-16 with LE BOM correctly', () => {
    const leBytes = Array.from(Buffer.from('日本語', 'utf16le'));
    const recordBytes = buildRecordBytes({
      textBytes: [0xff, 0xfe, ...leBytes],
      langBytes: Array.from(Buffer.from('en', 'utf8')),
      isUtf16: true,
    });
    expect(decodeNdefText(recordBytes)).toBe('日本語');
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
    expect(decodeNdefText(recordBytes)).toBe('bonjour');
  });

  it('rejects a normal-record header shorter than seven bytes', () => {
    expect(() => decodeNdefText([0xc1, 0x01, 0, 0, 0, 1])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('rejects declared type or payload lengths that extend past the input', () => {
    expect(() => decodeNdefText([0xd1, 0x04, 0x01, 0x54, 0])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
    expect(() => decodeNdefText([0xd1, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('rejects a language length larger than the declared payload', () => {
    expect(() => decodeNdefText([0xd1, 0x01, 0x01, 0x54, 0x3f])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('rejects record types it cannot turn into text, and overlong language tags', () => {
    // Well-known type 'X' is nothing the reader knows.
    expect(() => decodeNdefText([0xd1, 0x01, 0x01, 0x58, 0])).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECORD' })
    );
    // TNF 0 (empty) carries no payload to read.
    expect(() => decodeNdefText([0xd0, 0x01, 0x01, 0x54, 0])).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECORD' })
    );
    expect(() => buildTextNdef('hello', { lang: 'x'.repeat(64) })).toThrow(
      expect.objectContaining({ code: 'INVALID_LANG_TAG' })
    );
  });

  it('expands a URI record through its identifier-code prefix', () => {
    const rest = Array.from(Buffer.from('creqAabc', 'utf8'));
    // 0x00: no prefix — the payload is the whole URI (numo/cashu style).
    const cashuUri = Array.from(Buffer.from('cashu:creqAabc', 'utf8'));
    expect(decodeNdefText([0xd1, 0x01, cashuUri.length + 1, 0x55, 0x00, ...cashuUri])).toBe(
      'cashu:creqAabc'
    );
    // 0x04: "https://"
    expect(decodeNdefText([0xd1, 0x01, rest.length + 1, 0x55, 0x04, ...rest])).toBe(
      'https://creqAabc'
    );
    expect(() => decodeNdefText([0xd1, 0x01, 0x02, 0x55, 0x7f, 0x41])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });

  it('reads a record that carries an ID field (IL flag set)', () => {
    const text = Array.from(Buffer.from('hi', 'utf8'));
    const payload = [0x02, 0x65, 0x6e, ...text]; // status, "en", text
    const id = [0x30]; // "0"
    // MB|ME|SR|IL, TNF=1
    const record = [0xd9, 0x01, payload.length, id.length, 0x54, ...id, ...payload];
    expect(decodeNdefText(record)).toBe('hi');
  });

  it('reads MIME and external records as UTF-8 text', () => {
    const body = Array.from(Buffer.from('bitcoin:?creq=CREQB1X', 'utf8'));
    const mime = Array.from(Buffer.from('text/plain', 'utf8'));
    expect(decodeNdefText([0xd2, mime.length, body.length, ...mime, ...body])).toBe(
      'bitcoin:?creq=CREQB1X'
    );
    const ext = Array.from(Buffer.from('cashu.space:creq', 'utf8'));
    expect(decodeNdefText([0xd4, ext.length, body.length, ...ext, ...body])).toBe(
      'bitcoin:?creq=CREQB1X'
    );
  });

  it('ignores records after the first one', () => {
    const first = buildTextNdef('first').slice(2);
    first[0] &= ~0x40; // clear ME: more records follow
    const second = buildTextNdef('second').slice(2);
    second[0] &= ~0x80; // clear MB
    expect(decodeNdefText([...first, ...second])).toBe('first');
  });

  it('refuses chunked records', () => {
    expect(() => decodeNdefText([0xf1, 0x01, 0x01, 0x54, 0x02])).toThrow(
      expect.objectContaining({ code: 'INVALID_NDEF_FORMAT' })
    );
  });
});

describe('parseCapabilityContainer', () => {
  // numo's CC: CCLEN 15, v2.0, MLe 59, MLc 52, NDEF file E104 max 0x70FF, r/w.
  const numo = [
    0x00, 0x0f, 0x20, 0x00, 0x3b, 0x00, 0x34, 0x04, 0x06, 0xe1, 0x04, 0x70, 0xff, 0x00, 0x00,
  ];

  it('reads limits and access from a Type 4 Tag CC', () => {
    expect(parseCapabilityContainer(numo)).toEqual({
      maxReadLength: 59,
      maxWriteLength: 52,
      maxNdefFileSize: 0x70ff,
      writable: true,
    });
    expect(parseCapabilityContainer([...numo.slice(0, 14), 0xff])?.writable).toBe(false);
  });

  it('returns null for anything that is not a CC', () => {
    expect(parseCapabilityContainer([])).toBeNull();
    expect(parseCapabilityContainer(numo.slice(0, 10))).toBeNull();
    expect(parseCapabilityContainer([0x00, 0x05, ...numo.slice(2)])).toBeNull();
    expect(parseCapabilityContainer([...numo.slice(0, 7), 0x05, ...numo.slice(8)])).toBeNull();
  });
});
