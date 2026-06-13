import {
  NUT_BEACON_FLAG_AUTO_REDEEM,
  NUT_BEACON_FLAG_NUT_REQUESTS,
  encodeBeaconTLV,
} from 'bitchat-module';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const P2PK_KEY = '02' + 'aa'.repeat(32);

// Golden byte vector — the wire layout contract shared with the native
// encoders (EcashAnnounceExtension.swift/.kt). If this assertion changes, the
// spec draft and both platforms must change with it.
describe('nut drop golden vectors', () => {
  it('capability beacon TLV: f0 27 "NUTB" 03 flags p2pk(33)', () => {
    const key = fromHex(P2PK_KEY);
    expect(
      hex(encodeBeaconTLV(NUT_BEACON_FLAG_NUT_REQUESTS | NUT_BEACON_FLAG_AUTO_REDEEM, key))
    ).toBe('f0274e55544203' + '03' + P2PK_KEY);
    expect(hex(encodeBeaconTLV(NUT_BEACON_FLAG_NUT_REQUESTS, key))).toBe(
      'f0274e55544203' + '01' + P2PK_KEY
    );
  });
});
