import { useEffect, useState, useCallback, useMemo } from 'react';
import { getBLEPeers, addBLEPeerListener, startBLE, type BLEPeer } from 'bitchat-module';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { areBLEPeerSnapshotsEquivalent } from '@/features/bitchat/lib/blePeerSnapshots';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { useBitchatBLEIdentityMaterial } from '@/features/bitchat/hooks/useBitchatBLEIdentityMaterial';
import { useBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { bitchatLog } from '@/shared/lib/logger';
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

let mockLoopState: MockBLEPeerLoopState = INITIAL_MOCK_BLE_PEER_LOOP_STATE;
let mockPeersSnapshot = buildMockBLEPeers(mockLoopState.count);
let mockPeersInterval: ReturnType<typeof setInterval> | null = null;
const mockPeerListeners = new Set<() => void>();

function notifyMockPeerListeners() {
  for (const listener of mockPeerListeners) listener();
}

function setMockPeersSnapshot(nextPeers: BLEPeer[]) {
  mockPeersSnapshot = nextPeers;
  notifyMockPeerListeners();
}

function startMockPeerLoop() {
  if (mockPeersInterval) return;
  setMockPeersSnapshot(buildMockBLEPeers(mockLoopState.count));
  mockPeersInterval = setInterval(() => {
    mockLoopState = getNextMockBLEPeerLoopState(mockLoopState);
    setMockPeersSnapshot(buildMockBLEPeers(mockLoopState.count));
  }, MOCK_BLE_PEER_LOOP_INTERVAL_MS);
}

function stopMockPeerLoopIfIdle() {
  if (mockPeerListeners.size > 0 || !mockPeersInterval) return;
  clearInterval(mockPeersInterval);
  mockPeersInterval = null;
  mockLoopState = INITIAL_MOCK_BLE_PEER_LOOP_STATE;
  mockPeersSnapshot = buildMockBLEPeers(mockLoopState.count);
}

function subscribeMockPeers(listener: () => void): () => void {
  mockPeerListeners.add(listener);
  startMockPeerLoop();
  return () => {
    mockPeerListeners.delete(listener);
    stopMockPeerLoopIfIdle();
  };
}

/**
 * Tracks the set of BLE mesh peers currently known to upstream bitchat's
 * `BLEService` — i.e. peers that have exchanged announce packets with us.
 * Mounting this hook is an explicit discovery action: it starts BLE with the
 * active Nostr-derived BitChat identity, which means upstream will announce.
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
  const nickname = useBitchatNickname();
  const profileScope = useBitchatProfileScope();
  const identityMaterial = useBitchatBLEIdentityMaterial();
  const [peers, setPeers] = useState<BLEPeer[]>(() =>
    mockMode ? mockPeersSnapshot : getBLEPeers()
  );

  const setPeersIfChanged = useCallback((nextPeers: BLEPeer[]) => {
    setPeers((current) =>
      areBLEPeerSnapshotsEquivalent(current, nextPeers) ? current : nextPeers
    );
  }, []);

  const refresh = useCallback(() => {
    if (mockMode) {
      setPeersIfChanged(mockPeersSnapshot);
      return;
    }
    setPeersIfChanged(getBLEPeers());
  }, [mockMode, setPeersIfChanged]);

  useEffect(() => {
    if (mockMode) {
      setPeersIfChanged(mockPeersSnapshot);
      return subscribeMockPeers(() => {
        setPeersIfChanged(mockPeersSnapshot);
      });
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

  useEffect(() => {
    if (mockMode || !nickname || !profileScope || !identityMaterial) return;

    let cancelled = false;
    startBLE(nickname, profileScope, identityMaterial)
      .then(() => {
        if (cancelled) return;
        refresh();
      })
      .catch((err) => {
        bitchatLog.error('bitchat.peers.ble_start_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [identityMaterial, mockMode, nickname, profileScope, refresh]);

  const connectedCount = useMemo(() => peers.filter((p) => p.isConnected).length, [peers]);

  return { peers, connectedCount, refresh };
}
