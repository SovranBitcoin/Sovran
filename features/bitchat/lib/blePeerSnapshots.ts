import type { BLEPeer } from 'bitchat-module';

function peerKey(peer: BLEPeer): string {
  // `nostrPubkeyHex` participates so the moment a peer hands us its Nostr
  // identity (favorites us back) the snapshot is not swallowed as equivalent —
  // that transition flips the peer from bearer to lockable.
  return `${peer.peerID}:${peer.nickname}:${peer.isConnected ? 1 : 0}:${peer.hasDirectLink ? 1 : 0}:${peer.nostrPubkeyHex ?? ''}`;
}

export function areBLEPeerSnapshotsEquivalent(
  current: readonly BLEPeer[],
  next: readonly BLEPeer[]
): boolean {
  if (current.length !== next.length) return false;
  if (current.length === 0) return true;

  const currentKeys = current.map(peerKey).sort();
  const nextKeys = next.map(peerKey).sort();
  for (let index = 0; index < currentKeys.length; index++) {
    if (currentKeys[index] !== nextKeys[index]) return false;
  }
  return true;
}

/**
 * A peer with no real-time link goes stale this long after its last verified
 * announce. Matches upstream's announce stale-timestamp gate, so anything we
 * hide here is something peers would refuse to accept an announce from
 * anyway.
 */
export const BLE_PEER_STALE_MS = 180_000;

/** UI cadence for re-running the freshness filter as lastSeen values age. */
export const BLE_PEER_FRESHNESS_TICK_MS = 30_000;

/**
 * Drops ghost peers from payment surfaces. Upstream's registry can retain an
 * identity forever: removal requires `!isConnected && age > retention`, but
 * `isConnected` is cached announce-time state that never flips when an
 * identity vanishes mid-link — exactly what happens when a nearby device
 * switches Sovran profiles (the old peerID's link rebinds to the new
 * identity, and its ghost entry survives with a stale `lastSeen`). A peer
 * qualifies while it has a live peripheral/central link, or until its last
 * announce goes stale.
 */
export function filterFreshBLEPeers(peers: readonly BLEPeer[], now: number): BLEPeer[] {
  return peers.filter((peer) => peer.hasDirectLink || now - peer.lastSeen <= BLE_PEER_STALE_MS);
}
