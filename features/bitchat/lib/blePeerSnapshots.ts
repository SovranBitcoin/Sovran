import type { BLEPeer } from 'bitchat-module';

function peerKey(peer: BLEPeer): string {
  // SVRN fields participate so a later announce that adds/changes the Sovran
  // extension (isSovranPeer flip, new lock key after a profile switch) is not
  // swallowed as an equivalent snapshot.
  return `${peer.peerID}:${peer.nickname}:${peer.isConnected ? 1 : 0}:${peer.hasDirectLink ? 1 : 0}:${peer.isSovranPeer ? 1 : 0}:${peer.capabilities}:${peer.p2pkPubkeyHex ?? ''}`;
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
