import {
  NUT_BEACON_FLAG_AUTO_REDEEM,
  NUT_BEACON_FLAG_NUT_REQUESTS,
  NUT_PAYLOAD_TYPE,
  SOLICIT_FLAG_SENDER_OFFLINE,
  base64ToBytes,
  bytesToBase64,
  decodePayment,
  decodeRequest,
  decodeSolicit,
  decodeStatus,
  encodeBeaconTLV,
  encodePayment,
  encodeRequest,
  encodeSolicit,
  encodeStatus,
  generateSolicitId,
  isNutPayloadType,
  solicitIdHex,
} from 'bitchat-module';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const SOLICIT_ID = fromHex('0102030405060708');

// Golden byte vectors — the wire layout contract shared with the native
// encoders (EcashAnnounceExtension.swift/.kt for the beacon; the payload
// codecs are JS-only since native is a dumb byte pipe). If one of these
// assertions changes, the spec draft and both platforms must change with it.
describe('nut drop golden vectors', () => {
  it('capability beacon TLV: f0 06 "NUTB" 02 flags', () => {
    expect(hex(encodeBeaconTLV(NUT_BEACON_FLAG_NUT_REQUESTS | NUT_BEACON_FLAG_AUTO_REDEEM))).toBe(
      'f0064e55544202' + '03'
    );
    expect(hex(encodeBeaconTLV(NUT_BEACON_FLAG_NUT_REQUESTS))).toBe('f0064e55544202' + '01');
  });

  it('solicit (0xA0): type | solicitId(8) | flags', () => {
    expect(hex(encodeSolicit({ solicitId: SOLICIT_ID, senderOffline: false }))).toBe(
      'a0' + '0102030405060708' + '00'
    );
    expect(hex(encodeSolicit({ solicitId: SOLICIT_ID, senderOffline: true }))).toBe(
      'a0' + '0102030405060708' + '01'
    );
  });

  it('request (0xA1): type | solicitId(8) | utf8 creq', () => {
    expect(hex(encodeRequest({ solicitId: SOLICIT_ID, creq: 'creqA' }))).toBe(
      'a1' + '0102030405060708' + '6372657141'
    );
  });

  it('payment (0xA2): type | utf8 json', () => {
    expect(hex(encodePayment('{"id":"x"}'))).toBe('a2' + '7b226964223a2278227d');
  });

  it('status (0xA3): type | status | reason | utf8 payment id', () => {
    expect(hex(encodeStatus({ status: 'received', reason: 'none', paymentId: 'x1' }))).toBe(
      'a3' + '01' + '00' + '7831'
    );
    expect(
      hex(encodeStatus({ status: 'rejected', reason: 'untrustedMint', paymentId: 'x1' }))
    ).toBe('a3' + '03' + '01' + '7831');
  });
});

describe('solicit codec', () => {
  it('round-trips and ignores trailing bytes (append-only layout)', () => {
    const decoded = decodeSolicit(fromHex('a0' + '0102030405060708' + '01' + 'deadbeef'));
    expect(decoded).not.toBeNull();
    expect(hex(decoded!.solicitId)).toBe('0102030405060708');
    expect(decoded!.senderOffline).toBe(true);
  });

  it('rejects truncated and wrong-type payloads', () => {
    expect(decodeSolicit(fromHex('a0' + '01020304050607'))).toBeNull();
    expect(decodeSolicit(fromHex('a1' + '0102030405060708' + '00'))).toBeNull();
  });

  it('generates 8-byte ids with hex keys', () => {
    const id = generateSolicitId();
    expect(id.length).toBe(8);
    expect(solicitIdHex(id)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('request codec', () => {
  it('round-trips a creq string', () => {
    const decoded = decodeRequest(encodeRequest({ solicitId: SOLICIT_ID, creq: 'creqAabc' }));
    expect(decoded).not.toBeNull();
    expect(decoded!.creq).toBe('creqAabc');
    expect(hex(decoded!.solicitId)).toBe(hex(SOLICIT_ID));
  });

  it('drops foreign content without the creq prefix', () => {
    const bytes = encodeRequest({ solicitId: SOLICIT_ID, creq: 'creqA' });
    bytes[9] = 0x78; // 'x' — corrupt the prefix
    expect(decodeRequest(bytes)).toBeNull();
  });

  it('drops invalid UTF-8', () => {
    const bytes = new Uint8Array([0xa1, ...SOLICIT_ID, 0xff, 0xfe]);
    expect(decodeRequest(bytes)).toBeNull();
  });

  it('refuses to encode a non-creq string', () => {
    expect(() => encodeRequest({ solicitId: SOLICIT_ID, creq: 'cashuB...' })).toThrow();
  });
});

describe('payment codec', () => {
  it('round-trips JSON and rejects empty payloads', () => {
    expect(decodePayment(encodePayment('{"id":"abc","proofs":[]}'))).toBe(
      '{"id":"abc","proofs":[]}'
    );
    expect(decodePayment(new Uint8Array([0xa2]))).toBeNull();
  });
});

describe('status codec', () => {
  it('round-trips all statuses', () => {
    for (const status of ['received', 'redeemed', 'rejected'] as const) {
      const decoded = decodeStatus(encodeStatus({ status, reason: 'none', paymentId: 'pid' }));
      expect(decoded).toEqual({ status, reason: 'none', paymentId: 'pid' });
    }
  });

  it('decodes unknown reason bytes as "unknown" instead of failing', () => {
    const bytes = encodeStatus({ status: 'rejected', reason: 'duplicate', paymentId: 'pid' });
    bytes[2] = 0x7f;
    expect(decodeStatus(bytes)).toEqual({
      status: 'rejected',
      reason: 'unknown',
      paymentId: 'pid',
    });
  });

  it('rejects unknown status bytes and empty payment ids', () => {
    const bytes = encodeStatus({ status: 'received', reason: 'none', paymentId: 'pid' });
    bytes[1] = 0x7f;
    expect(decodeStatus(bytes)).toBeNull();
    expect(decodeStatus(fromHex('a3' + '01' + '00'))).toBeNull();
  });
});

describe('payload type range', () => {
  it('covers exactly 0xA0–0xA3', () => {
    expect(Object.values(NUT_PAYLOAD_TYPE).every(isNutPayloadType)).toBe(true);
    expect(isNutPayloadType(0x9f)).toBe(false);
    expect(isNutPayloadType(0xa4)).toBe(false);
    expect(SOLICIT_FLAG_SENDER_OFFLINE).toBe(0x01);
  });
});

describe('base64 helpers (bridge boundary)', () => {
  it('round-trips all byte values and padding lengths', () => {
    for (const length of [0, 1, 2, 3, 4, 255]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 7 + length) & 0xff);
      const roundTripped = base64ToBytes(bytesToBase64(bytes));
      expect(roundTripped).not.toBeNull();
      expect(hex(roundTripped!)).toBe(hex(bytes));
    }
  });

  it('matches the platform base64 alphabet', () => {
    expect(bytesToBase64(fromHex('a00102030405060708ff'))).toBe('oAECAwQFBgcI/w==');
  });

  it('returns null on malformed input', () => {
    expect(base64ToBytes('not base64!!')).toBeNull();
  });
});
