/**
 * @jest-environment node
 */

import { PaymentRequest } from '@cashu/cashu-ts';
import { planNearPaySend } from '@/features/nearPay/lib/nearPaySendDecision';
import { cashuP2pkPubkeyFromNostrHex } from '@/shared/lib/protocolIds';

const fixtureRequest = ({ mints, pubkey33 }: { mints: string[]; pubkey33: string }) =>
  new PaymentRequest(undefined, 'fixture-request', undefined, 'sat', mints, undefined, false, {
    kind: 'P2PK',
    data: pubkey33,
    tags: [],
  }).toEncodedRequest();

const NOSTR_HEX = 'ab'.repeat(32);
const PUBKEY_33 = cashuP2pkPubkeyFromNostrHex(NOSTR_HEX);
const MINT_A = 'https://mint.a.example';
const MINT_B = 'https://mint.b.example';
const MINT_C = 'https://mint.c.example';

const creqFor = (mints: string[]) => fixtureRequest({ mints, pubkey33: PUBKEY_33 })!;

describe('planNearPaySend', () => {
  it('rejects a self-asserted key even with a matching request', () => {
    expect(
      planNearPaySend({
        peer: { creq: creqFor([MINT_A]), nostrPubkeyHex: NOSTR_HEX },
        ourMints: [MINT_A],
        isOffline: false,
      })
    ).toEqual({ mode: 'block', reason: 'unverified' });
  });
  it('locks to a shared mint when online with a valid creq', () => {
    const plan = planNearPaySend({
      peer: {
        walletCapabilityExpiresAt: Date.now() + 60_000,
        creq: creqFor([MINT_A, MINT_B]),
        nostrPubkeyHex: NOSTR_HEX,
      },
      ourMints: [MINT_B, MINT_C],
      isOffline: false,
    });

    expect(plan).toEqual({
      mode: 'lock',
      lockPubkey: PUBKEY_33,
      recipientPubkey: NOSTR_HEX,
      allowedMints: [MINT_B],
      identityVerified: true,
    });
  });

  it('blocks when there is no shared mint', () => {
    const plan = planNearPaySend({
      peer: {
        walletCapabilityExpiresAt: Date.now() + 60_000,
        creq: creqFor([MINT_A]),
        nostrPubkeyHex: NOSTR_HEX,
      },
      ourMints: [MINT_C],
      isOffline: false,
    });

    expect(plan).toEqual({ mode: 'block', reason: 'no-shared-mint' });
  });

  it('blocks offline rather than downgrade the payment lock', () => {
    const plan = planNearPaySend({
      peer: {
        walletCapabilityExpiresAt: Date.now() + 60_000,
        creq: creqFor([MINT_A, MINT_B]),
        nostrPubkeyHex: NOSTR_HEX,
      },
      ourMints: [MINT_B, MINT_C],
      isOffline: true,
    });

    expect(plan).toEqual({ mode: 'block', reason: 'offline' });
  });

  it('blocks when the peer has not advertised a creq capability', () => {
    const plan = planNearPaySend({
      peer: {
        walletCapabilityExpiresAt: Date.now() + 60_000,
        creq: undefined,
        nostrPubkeyHex: NOSTR_HEX,
      },
      ourMints: [MINT_A],
      isOffline: false,
    });

    expect(plan).toEqual({ mode: 'block', reason: 'no-creq' });
  });

  it('blocks when the creq lock key mismatches the npub', () => {
    const plan = planNearPaySend({
      // Valid creq, but announced under a different identity → not lockable.
      peer: {
        walletCapabilityExpiresAt: Date.now() + 60_000,
        creq: creqFor([MINT_A]),
        nostrPubkeyHex: 'cd'.repeat(32),
      },
      ourMints: [MINT_A],
      isOffline: false,
    });

    expect(plan).toEqual({ mode: 'block', reason: 'invalid-creq' });
  });
});
