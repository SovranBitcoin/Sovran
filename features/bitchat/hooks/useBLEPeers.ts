import { useEffect, useState, useCallback, useMemo } from 'react';
import { getBLEPeers, addBLEPeerListener, type BLEPeer } from 'bitchat-module';

interface UseBLEPeersResult {
  peers: BLEPeer[];
  connectedCount: number;
  refresh: () => void;
}

/**
 * Tracks the set of BLE mesh peers currently known to upstream bitchat's
 * `BLEService` — i.e. peers that have exchanged announce packets with us.
 *
 * Sources:
 *  - Initial snapshot on mount via `getBLEPeers()`.
 *  - Native `onBLEPeerUpdate` events fire on connect / disconnect / list
 *    change. Each event triggers a re-fetch because the event payload
 *    only carries a subset (peerID or a flat list) — not the full shape
 *    with nickname + lastSeen.
 *  - A slow poll (5 s) as a safety net in case a peer-update event is
 *    missed or coalesced.
 *
 * Upstream bitchat's equivalent (UnifiedPeerService.$peers) is a Combine
 * publisher; we mirror it with React state here.
 */
export function useBLEPeers(): UseBLEPeersResult {
  const [peers, setPeers] = useState<BLEPeer[]>(() => getBLEPeers());

  const refresh = useCallback(() => {
    setPeers(getBLEPeers());
  }, []);

  useEffect(() => {
    refresh();
    const sub = addBLEPeerListener(() => {
      refresh();
    });
    const interval = setInterval(refresh, 5_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [refresh]);

  const connectedCount = useMemo(() => peers.filter((p) => p.isConnected).length, [peers]);

  return { peers, connectedCount, refresh };
}
