/** @jest-environment node */
import { getPublicKey } from 'nostr-tools/pure';
import { nprofileEncode } from 'nostr-tools/nip19';
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import {
  createNearbyCapability,
  nearbyNoiseIdentity,
  verifyNearbyCapability,
} from '@/features/nearPay/lib/nearbyCapability';
const key = new Uint8Array(32).fill(1);
const pubkey = getPublicKey(key);
const noise = '02'.repeat(32);
const fingerprint = nearbyNoiseIdentity(noise).fingerprint;
const now = 1_800_000_000_000;
const request = (recipient = pubkey, amount?: number, withTransport = true) =>
  new PaymentRequest(
    withTransport
      ? [{ type: PaymentRequestTransportType.NOSTR, target: nprofileEncode({ pubkey: recipient }) }]
      : undefined,
    'standing-1',
    amount,
    'sat',
    ['https://mint.example'],
    undefined,
    false,
    { kind: 'P2PK', data: `02${pubkey}`, tags: [] }
  ).toEncodedRequest();
describe('authenticated wallet capability', () => {
  it('binds the Nostr payment identity to the authenticated Noise key', () => {
    const content = createNearbyCapability(key, noise, request(), now);
    expect(verifyNearbyCapability(content, fingerprint, now)).toMatchObject({
      nostrPubkeyHex: pubkey,
      creq: request(),
    });
    expect(verifyNearbyCapability(content, 'ff'.repeat(32), now)).toBeNull();
    expect(verifyNearbyCapability(content, undefined, now)).toBeNull();
  });
  it('rejects tampering, stale capabilities and an unrelated Nostr destination', () => {
    const content = createNearbyCapability(key, noise, request(), now);
    expect(verifyNearbyCapability(content, fingerprint, now + 120_000)).toBeNull();
    expect(
      verifyNearbyCapability(content.replace('sovran-nearby', 'forged-nearby'), fingerprint, now)
    ).toBeNull();
    expect(
      verifyNearbyCapability(
        createNearbyCapability(key, noise, request('aa'.repeat(32)), now),
        fingerprint,
        now
      )
    ).toBeNull();
  });
  it('accepts a Bluetooth-only standing wallet but rejects a fixed-amount request', () => {
    expect(
      verifyNearbyCapability(
        createNearbyCapability(key, noise, request(pubkey, undefined, false), now),
        fingerprint,
        now
      )?.nostrPubkeyHex
    ).toBe(pubkey);
    expect(
      verifyNearbyCapability(
        createNearbyCapability(key, noise, request(pubkey, 5), now),
        fingerprint,
        now
      )
    ).toBeNull();
  });
  it('authenticates capability withdrawal', () => {
    expect(
      verifyNearbyCapability(createNearbyCapability(key, noise, null, now), fingerprint, now)
    ).toMatchObject({ creq: null, nostrPubkeyHex: pubkey });
  });
});
