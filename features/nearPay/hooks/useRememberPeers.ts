/**
 * @fileoverview Persist mesh peers for later quick-pay.
 *
 * Whenever we resolve a peer's Nostr identity over the Nut Drop mesh, remember
 * them (pubkey + BLE nickname) in `recentPeopleStore` so the Send modal's
 * quick-pay tier can offer them by last-seen AFTER they leave range — the live
 * BLE list is session-only. Used by both the radar and the Send screen so a
 * peer seen in either place is remembered.
 *
 * Idempotent and keyed by the identified-peer set + their nicknames, so it
 * writes when a peer appears or renames, not on every freshness tick.
 */

import { useEffect, useMemo } from 'react';
import type { BLEPeer } from 'bitchat-module';

import { peerDisplayName, peerNostrPubkey } from '@/features/nearPay/lib/peerProfile';
import { useRecentPeopleStore } from '@/shared/stores/profile/recentPeopleStore';

export function useRememberPeers(peers: readonly BLEPeer[]): void {
  const identified = useMemo(() => peers.filter((peer) => peerNostrPubkey(peer) != null), [peers]);
  const key = identified
    .map((peer) => `${peerNostrPubkey(peer)}:${peerDisplayName(peer)}`)
    .join('|');

  useEffect(() => {
    const addRecentPerson = useRecentPeopleStore.getState().addRecentPerson;
    for (const peer of identified) {
      const pubkey = peerNostrPubkey(peer);
      if (pubkey) addRecentPerson(pubkey, { reason: 'peer', displayName: peerDisplayName(peer) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed via `key`
  }, [key]);
}
