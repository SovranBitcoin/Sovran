import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getBLEPeers,
  addBLEPeerListener,
  addBLEStateListener,
  startBLE,
  type BLEPeer,
} from 'bitchat-module';
import { areBLEPeerSnapshotsEquivalent } from '@/features/bitchat/lib/blePeerSnapshots';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { useBitchatBLEIdentityMaterial } from '@/features/bitchat/hooks/useBitchatBLEIdentityMaterial';
import { useBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { bitchatLog } from '@/shared/lib/logger';

interface UseBLEPeersResult {
  peers: BLEPeer[];
  connectedCount: number;
  refresh: () => void;
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
  const nickname = useBitchatNickname();
  const profileScope = useBitchatProfileScope();
  const identityMaterial = useBitchatBLEIdentityMaterial();
  const [peers, setPeers] = useState<BLEPeer[]>(() => getBLEPeers());

  const setPeersIfChanged = useCallback((nextPeers: BLEPeer[]) => {
    setPeers((current) =>
      areBLEPeerSnapshotsEquivalent(current, nextPeers) ? current : nextPeers
    );
  }, []);

  const refresh = useCallback(() => {
    setPeersIfChanged(getBLEPeers());
  }, [setPeersIfChanged]);

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

  useEffect(() => {
    if (!nickname || !profileScope || !identityMaterial) return;

    let cancelled = false;
    const attempt = () => {
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
    };
    attempt();
    // startBLE rejects while Bluetooth is unauthorized or powered off
    // (Android). Retry when the adapter reports ready — startBLE is
    // idempotent natively (same scope + identity → no-op), so re-attempts
    // after a permission grant or radio toggle are safe on both platforms.
    const stateSub = addBLEStateListener((event) => {
      if (event.state === 'poweredOn') attempt();
    });

    return () => {
      cancelled = true;
      stateSub.remove();
    };
  }, [identityMaterial, nickname, profileScope, refresh]);

  const connectedCount = useMemo(() => peers.filter((p) => p.isConnected).length, [peers]);

  return { peers, connectedCount, refresh };
}
