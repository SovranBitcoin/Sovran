import type { BLEPeer } from 'bitchat-module';

import { lockableMintsFromCreq } from '@/shared/lib/nutCreq';

/**
 * Decides how a Nut Drop sends to a peer, from the peer's standing `creq`
 * (accepted mints + P2PK lock key), our trusted mints, and online status.
 *
 * - **lock** — the peer is cashu-capable (valid creq), we're online (a P2PK lock
 *   needs a mint swap), and we share a mint it accepts → lock the token to its
 *   key, minting from a shared mint.
 * - **bearer** — either offline (can't lock; send from a shared mint), or the
 *   peer advertised no usable creq (best-effort, we don't know its mints).
 * - **block** — the peer has a creq but we share NO mint it accepts; a token
 *   from a mint it doesn't accept is unredeemable, so don't send.
 *
 * Delivery is always a private Noise DM (handled by the caller); these modes
 * only decide the token's lock + source mint.
 */
type NearPaySendPlan =
  | { mode: 'lock'; lockPubkey: string; recipientPubkey: string; allowedMints: string[] }
  | { mode: 'bearer'; allowedMints: string[] | null }
  | { mode: 'block'; reason: 'no-shared-mint' };

export function planNearPaySend(args: {
  peer: Pick<BLEPeer, 'creq' | 'nostrPubkeyHex'>;
  ourMints: readonly string[];
  isOffline: boolean;
}): NearPaySendPlan {
  const { peer, ourMints, isOffline } = args;
  const acceptedMints = lockableMintsFromCreq(peer.creq, peer.nostrPubkeyHex);

  // No valid creq (stock peer, or one we haven't exchanged identity with) →
  // best-effort bearer from our own mint; we can't know what they accept.
  if (!acceptedMints || !peer.nostrPubkeyHex) {
    return { mode: 'bearer', allowedMints: null };
  }

  const shared = ourMints.filter((m) => acceptedMints.includes(m));
  if (shared.length === 0) {
    return { mode: 'block', reason: 'no-shared-mint' };
  }
  if (isOffline) {
    // Offline: P2PK locking needs a mint swap → bearer from a shared mint
    // (still redeemable, and the DM keeps it private).
    return { mode: 'bearer', allowedMints: shared };
  }
  return {
    mode: 'lock',
    lockPubkey: `02${peer.nostrPubkeyHex}`,
    recipientPubkey: peer.nostrPubkeyHex,
    allowedMints: shared,
  };
}
