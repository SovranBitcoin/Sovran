import { useEffect, useMemo, useState } from 'react';

import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import {
  BLE_PEER_FRESHNESS_TICK_MS,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';
import type { BLEPeer } from 'bitchat-module';
import { useEagerPeerFavorite } from '@/features/nearPay/hooks/useEagerPeerFavorite';

/**
 * The nearby peers a NearPay surface may act on.
 *
 * Every bitchat peer is surfaced so the favorite exchange can run, but ghost
 * entries (a nearby device's previous profile identities, which upstream's
 * registry can retain forever) are dropped by the freshness filter; the
 * periodic tick re-evaluates it as `lastSeen` values age out.
 *
 * Peers are eagerly favorited so Sovran peers reciprocate their Nostr identity
 * — bitchat's only native mesh channel for exchanging one — and become
 * lockable-on-sight. That is bounded to while the caller is mounted.
 */
export function useFreshNearbyPeers(): BLEPeer[] {
  const { peers: blePeers } = useBLEPeers();
  const [peerFreshnessNow, setPeerFreshnessNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setPeerFreshnessNow(Date.now()), BLE_PEER_FRESHNESS_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  const peers = useMemo(
    () => filterFreshBLEPeers(blePeers, peerFreshnessNow),
    [blePeers, peerFreshnessNow]
  );
  useEagerPeerFavorite(peers);
  return peers;
}
