import type { BLEPeer } from 'bitchat-module';

import { paymentLog } from '@/shared/lib/logger';
import { lockableMintsFromCreq } from '@/shared/lib/nutCreq';

/**
 * Decides how a Nut Drop sends to a peer, from the peer's standing `creq`
 * (accepted mints + P2PK lock key), our trusted mints, and online status.
 *
 * - **lock** — the peer is cashu-capable (valid creq), we're online (a P2PK lock
 *   needs a mint swap), and we share a mint it accepts → lock the token to its
 *   key, minting from a shared mint.
 * - **bearer** — offline only, after a valid creq proved the peer is a patched
 *   Sovran client and we share a mint it accepts.
 * - **block** — no usable creq (unconfirmed patched client), or no shared mint.
 *
 * Delivery is always a private Noise DM (handled by the caller); these modes
 * only decide the token's lock + source mint.
 */
type NearPaySendPlan =
  | {
      mode: 'lock';
      lockPubkey: string;
      recipientPubkey: string;
      allowedMints: string[];
      /**
       * The lock target is the peer's SELF-ASSERTED npub (from its creq /
       * bitchat favorite) — nothing proves the nearby device controls that key.
       * A spoofer could advertise someone else's npub; funds would then lock to
       * a key the receiver can't redeem (no theft, but unrecoverable without a
       * refund path). Callers should surface this as "unverified". (audit ND-1)
       */
      identityVerified: false;
    }
  | { mode: 'bearer'; allowedMints: string[] | null; requiresConsent: boolean }
  | { mode: 'block'; reason: 'no-creq' | 'invalid-creq' | 'no-shared-mint' };

export function planNearPaySend(args: {
  peer: Pick<BLEPeer, 'creq' | 'nostrPubkeyHex'>;
  ourMints: readonly string[];
  isOffline: boolean;
}): NearPaySendPlan {
  const { peer, ourMints, isOffline } = args;
  const acceptedMints = lockableMintsFromCreq(peer.creq, peer.nostrPubkeyHex);
  const logBase = {
    peerHasCreq: !!peer.creq,
    peerHasNostrPubkey: !!peer.nostrPubkeyHex,
    creqLength: peer.creq?.length ?? 0,
    nostrPubkeyLength: peer.nostrPubkeyHex?.length ?? 0,
    ourMintCount: ourMints.length,
    isOffline,
    acceptedMintCount: acceptedMints?.length ?? 0,
  };

  // A valid creq favorite is the capability signal for the extended private-DM
  // wire format. Without it, a stock or stale client could drop the token.
  if (!peer.creq || !peer.nostrPubkeyHex) {
    paymentLog.info('near_pay.send.plan', {
      ...logBase,
      mode: 'block',
      reason: 'no-creq',
    });
    return { mode: 'block', reason: 'no-creq' };
  }
  if (!acceptedMints) {
    paymentLog.info('near_pay.send.plan', {
      ...logBase,
      mode: 'block',
      reason: 'invalid-creq',
    });
    return { mode: 'block', reason: 'invalid-creq' };
  }

  const shared = ourMints.filter((m) => acceptedMints.includes(m));
  if (shared.length === 0) {
    paymentLog.info('near_pay.send.plan', {
      ...logBase,
      mode: 'block',
      reason: 'no-shared-mint',
      sharedMintCount: 0,
    });
    return { mode: 'block', reason: 'no-shared-mint' };
  }
  if (isOffline) {
    // Offline: P2PK locking needs a mint swap, so we can only send bearer from a
    // shared mint. A bearer token is redeemable by anyone who gets the bytes, so
    // this downgrade requires explicit user consent — never silent. (audit ND-2)
    paymentLog.info('near_pay.send.plan', {
      ...logBase,
      mode: 'bearer',
      requiresConsent: true,
      sharedMintCount: shared.length,
    });
    return { mode: 'bearer', allowedMints: shared, requiresConsent: true };
  }
  paymentLog.info('near_pay.send.plan', {
    ...logBase,
    mode: 'lock',
    sharedMintCount: shared.length,
  });
  return {
    mode: 'lock',
    lockPubkey: `02${peer.nostrPubkeyHex}`,
    recipientPubkey: peer.nostrPubkeyHex,
    allowedMints: shared,
    identityVerified: false,
  };
}
