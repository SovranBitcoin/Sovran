import { useEffect, useMemo, useState } from 'react';

import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import {
  BLE_PEER_FRESHNESS_TICK_MS,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';
import type { BLEPeer } from 'bitchat-module';
import { isPayableNearbyPeer } from '../lib/nearbyCapability';

/** Fresh, authenticated wallet recipients. Relay membership is independent. */
export function useFreshNearbyPeers(): BLEPeer[] {
  const { peers: blePeers } = useBLEPeers();
  const [peerFreshnessNow, setPeerFreshnessNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setPeerFreshnessNow(Date.now()), BLE_PEER_FRESHNESS_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  const peers = useMemo(
    () =>
      filterFreshBLEPeers(blePeers, peerFreshnessNow).filter((peer) =>
        isPayableNearbyPeer(peer, peerFreshnessNow)
      ),
    [blePeers, peerFreshnessNow]
  );
  return peers;
}
