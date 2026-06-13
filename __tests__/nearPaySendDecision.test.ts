/**
 * @jest-environment node
 */

import { planNearPaySend } from '@/features/nearPay/lib/nearPaySendDecision';
import { buildStandingCreq } from '@/shared/lib/nutCreq';

const NOSTR_HEX = 'ab'.repeat(32);
const PUBKEY_33 = `02${NOSTR_HEX}`;
const MINT_A = 'https://mint.a.example';
const MINT_B = 'https://mint.b.example';
const MINT_C = 'https://mint.c.example';

const creqFor = (mints: string[]) => buildStandingCreq({ mints, pubkey33: PUBKEY_33 })!;

describe('planNearPaySend', () => {
  it('locks to a shared mint when online with a valid creq', () => {
    const plan = planNearPaySend({
      peer: { creq: creqFor([MINT_A, MINT_B]), nostrPubkeyHex: NOSTR_HEX },
      ourMints: [MINT_B, MINT_C],
      isOffline: false,
    });

    expect(plan).toEqual({
      mode: 'lock',
      lockPubkey: PUBKEY_33,
      recipientPubkey: NOSTR_HEX,
      allowedMints: [MINT_B],
    });
  });

  it('blocks when there is no shared mint', () => {
    const plan = planNearPaySend({
      peer: { creq: creqFor([MINT_A]), nostrPubkeyHex: NOSTR_HEX },
      ourMints: [MINT_C],
      isOffline: false,
    });

    expect(plan).toEqual({ mode: 'block', reason: 'no-shared-mint' });
  });

  it('falls back to a bearer from a shared mint when offline (cannot P2PK-lock)', () => {
    const plan = planNearPaySend({
      peer: { creq: creqFor([MINT_A, MINT_B]), nostrPubkeyHex: NOSTR_HEX },
      ourMints: [MINT_B, MINT_C],
      isOffline: true,
    });

    expect(plan).toEqual({ mode: 'bearer', allowedMints: [MINT_B] });
  });

  it('falls back to a best-effort bearer when the peer has no creq', () => {
    const plan = planNearPaySend({
      peer: { creq: undefined, nostrPubkeyHex: NOSTR_HEX },
      ourMints: [MINT_A],
      isOffline: false,
    });

    expect(plan).toEqual({ mode: 'bearer', allowedMints: null });
  });

  it('falls back to a best-effort bearer when the creq lock key mismatches the npub', () => {
    const plan = planNearPaySend({
      // Valid creq, but announced under a different identity → not lockable.
      peer: { creq: creqFor([MINT_A]), nostrPubkeyHex: 'cd'.repeat(32) },
      ourMints: [MINT_A],
      isOffline: false,
    });

    expect(plan).toEqual({ mode: 'bearer', allowedMints: null });
  });
});
