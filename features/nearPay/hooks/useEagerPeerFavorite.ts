import { useEffect, useRef } from 'react';

import { sendBLEFavorite, type BLEPeer } from 'bitchat-module';

import { paymentLog } from '@/shared/lib/logger';

/**
 * Eagerly hand our identity + accepted mints to every nearby peer via bitchat's
 * NATIVE favorite notification (`[FAVORITED]:<npub>:<creq>`). bitchat exposes no
 * other way to learn a peer's Nostr identity over the mesh (the announce carries
 * no Nostr key), so we favorite on discovery: a Sovran peer reciprocates and
 * becomes lockable-on-sight (its `nostrPubkeyHex` + `creq` arrive on the next
 * peer poll), while a stock peer can't decode our creq-bearing favorite (it
 * exceeds the stock 255-byte cap) and so never reciprocates (→ bearer only).
 *
 * Active only while the calling NearPay surface is mounted, so the favorite
 * signal is bounded to "the user is actively looking to pay nearby". Each peer
 * is favorited once per mount; a failed send is retried on the next poll.
 */
export function useEagerPeerFavorite(peers: readonly Pick<BLEPeer, 'peerID'>[]): void {
  const favorited = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const peer of peers) {
      if (favorited.current.has(peer.peerID)) continue;
      favorited.current.add(peer.peerID);
      // Breadcrumb so log.txt shows the exchange firing — pair with the
      // `bitchat.peers.snapshot` `hasNostrIdentity` flag to confirm a peer goes
      // bearer → lockable. (Whether the favorite actually reaches the peer is
      // gated natively on the handshake tie-breaker.)
      paymentLog.debug('near_pay.favorite.send', { peerID: peer.peerID });
      void sendBLEFavorite(peer.peerID, true).catch((err: unknown) => {
        // Allow a retry on the next poll if the send threw (e.g. mesh not
        // ready yet) rather than permanently skipping the peer.
        favorited.current.delete(peer.peerID);
        paymentLog.warn('near_pay.favorite.send_failed', {
          peerID: peer.peerID,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }, [peers]);
}
