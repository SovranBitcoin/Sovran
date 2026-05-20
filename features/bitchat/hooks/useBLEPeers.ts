import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { getBLEPeers, addBLEPeerListener, type BLEPeer } from 'bitchat-module';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { areBLEPeerSnapshotsEquivalent } from '@/features/bitchat/lib/blePeerSnapshots';
import {
  buildMockBLEPeers,
  INITIAL_MOCK_BLE_PEER_LOOP_STATE,
  getNextMockBLEPeerLoopState,
  MOCK_BLE_PEER_LOOP_INTERVAL_MS,
  type MockBLEPeerLoopState,
} from '@/features/bitchat/lib/mockBLEPeers';

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
  const mockMode = useSettingsStore((state) => state.mockMode);
  const mockLoopRef = useRef<MockBLEPeerLoopState>(INITIAL_MOCK_BLE_PEER_LOOP_STATE);
  const [peers, setPeers] = useState<BLEPeer[]>(() => getBLEPeers());

  const setPeersIfChanged = useCallback((nextPeers: BLEPeer[]) => {
    setPeers((current) =>
      areBLEPeerSnapshotsEquivalent(current, nextPeers) ? current : nextPeers
    );
  }, []);

  const refresh = useCallback(() => {
    if (mockMode) {
      setPeersIfChanged(buildMockBLEPeers(mockLoopRef.current.count));
      return;
    }
    setPeersIfChanged(getBLEPeers());
  }, [mockMode, setPeersIfChanged]);

  useEffect(() => {
    if (mockMode) {
      mockLoopRef.current = INITIAL_MOCK_BLE_PEER_LOOP_STATE;
      setPeersIfChanged(buildMockBLEPeers(mockLoopRef.current.count));
      const interval = setInterval(() => {
        mockLoopRef.current = getNextMockBLEPeerLoopState(mockLoopRef.current);
        setPeersIfChanged(buildMockBLEPeers(mockLoopRef.current.count));
      }, MOCK_BLE_PEER_LOOP_INTERVAL_MS);
      return () => clearInterval(interval);
    }

    refresh();
    const sub = addBLEPeerListener(() => {
      refresh();
    });
    const interval = setInterval(refresh, 5_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [mockMode, refresh, setPeersIfChanged]);

  const connectedCount = useMemo(() => peers.filter((p) => p.isConnected).length, [peers]);

  return { peers, connectedCount, refresh };
}
