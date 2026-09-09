import { useState, useCallback, useMemo } from 'react';
import {
  getBLEPeers,
  getBLEState,
  bitchatVendorVersion,
  addBLEPeerListener,
  addBLEPeerIdentityListener,
  addBLEStateListener,
  startBLE,
  type BLEPeer,
} from 'bitchat-module';
import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import { useMints } from '@cashu/coco-react';
import { areBLEPeerSnapshotsEquivalent } from '@/features/bitchat/lib/blePeerSnapshots';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { useBitchatBLEIdentityMaterial } from '@/features/bitchat/hooks/useBitchatBLEIdentityMaterial';
import { useBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { cashuP2pkPubkeyFromNostrHex } from '@/shared/lib/protocolIds';
import { bitchatLog } from '@/shared/lib/logger';
import { buildStandingCreq } from '@/shared/lib/nutCreq';

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
  // Build our standing NUT-18 payment request (accepted mints + P2PK lock key)
  // so the favorite advertises it (`[FAVORITED]:<npub>:<creq>`). Keyed on the
  // mint-URL set so it only rebuilds when trusted mints change; startBLE updates
  // the native creq without restarting the mesh.
  const { trustedMints } = useMints();
  const mintUrlsKey = useMemo(
    () =>
      trustedMints
        .map((m) => m.mintUrl)
        .sort()
        .join(','),
    [trustedMints]
  );
  const creq = useMemo(() => {
    if (!identityMaterial || !mintUrlsKey) return null;
    return buildStandingCreq({
      mints: mintUrlsKey.split(','),
      pubkey33: cashuP2pkPubkeyFromNostrHex(identityMaterial.nostrPubkey),
    });
  }, [mintUrlsKey, identityMaterial]);
  const [peers, setPeers] = useState<BLEPeer[]>(() => getBLEPeers());

  const setPeersIfChanged = useCallback((nextPeers: BLEPeer[]) => {
    setPeers((current) => {
      if (areBLEPeerSnapshotsEquivalent(current, nextPeers)) return current;
      // One line per snapshot change — the ground truth for "why does this
      // peer show the bearer badge" / "why is there no Nostr identity yet".
      // A peer's Nostr identity arrives only after it favorites us back over
      // bitchat's native favorite channel (`nostrPubkeyHex`).
      bitchatLog.info('bitchat.peers.snapshot', {
        count: nextPeers.length,
        peers: nextPeers.map((peer) => ({
          peerID: peer.peerID,
          nickname: peer.nickname,
          hasNostrIdentity: !!peer.nostrPubkeyHex,
          // Whether the peer's favorite carried a NUT-18 creq (its accepted
          // mints + lock key). Identity can arrive without a creq, so this is
          // the ground truth for "is this peer lockable" vs bearer-only. The
          // parse itself is verified at send time (`near_pay.send.plan`).
          hasCreq: !!peer.creq,
          creqLen: peer.creq?.length ?? 0,
          hasDirectLink: peer.hasDirectLink,
          isConnected: peer.isConnected,
        })),
      });
      return nextPeers;
    });
  }, []);

  const refresh = useCallback(() => {
    setPeersIfChanged(getBLEPeers());
  }, [setPeersIfChanged]);

  useVisualActivityEffect(
    useCallback(() => {
      refresh();
      const sub = addBLEPeerListener(() => {
        refresh();
      });
      // A peer handing us its Nostr identity (favoriting us back with a creq
      // suffix) flips it bearer → lockable; refresh immediately so the radar
      // doesn't wait up to 5 s for the next poll. iOS emits this; Android relies
      // on the poll. peerKey includes nostrPubkeyHex, so the snapshot updates.
      const identitySub = addBLEPeerIdentityListener(() => {
        refresh();
      });
      const interval = setInterval(refresh, 5_000);
      return () => {
        sub.remove();
        identitySub.remove();
        clearInterval(interval);
      };
    }, [refresh])
  );

  useVisualActivityEffect(
    useCallback(() => {
      if (!nickname || !profileScope || !identityMaterial) {
        // Without this line a missing input is indistinguishable from "started
        // but alone" — the #1 cause of a forever-"Scanning nearby" radar.
        bitchatLog.warn('bitchat.peers.ble_start_blocked', {
          hasNickname: !!nickname,
          hasProfileScope: !!profileScope,
          hasIdentityMaterial: !!identityMaterial,
        });
        return;
      }

      let cancelled = false;
      const attempt = () => {
        startBLE(nickname, profileScope, identityMaterial, creq)
          .then(() => {
            if (cancelled) return;
            bitchatLog.info('bitchat.peers.ble_start_ok', {
              bleState: getBLEState(),
              initialPeerCount: getBLEPeers().length,
              // The vendored bitchat commit this native build compiled from. Verify
              // it matches the intended pin — a stale build (e.g. one predating the
              // fragment fix) shows the wrong SHA here.
              vendorVersion: bitchatVendorVersion(),
            });
            refresh();
          })
          .catch((err) => {
            bitchatLog.error('bitchat.peers.ble_start_failed', {
              bleState: getBLEState(),
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
        bitchatLog.info('bitchat.peers.ble_state_changed', { state: event.state });
        if (event.state === 'poweredOn') attempt();
      });

      return () => {
        cancelled = true;
        stateSub.remove();
      };
    }, [identityMaterial, nickname, profileScope, creq, refresh])
  );

  const connectedCount = useMemo(() => peers.filter((p) => p.isConnected).length, [peers]);

  return { peers, connectedCount, refresh };
}
