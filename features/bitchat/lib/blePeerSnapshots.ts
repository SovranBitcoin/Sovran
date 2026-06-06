import type { BLEPeer } from 'bitchat-module';

function peerKey(peer: BLEPeer): string {
  return `${peer.peerID}:${peer.nickname}:${peer.isConnected ? 1 : 0}:${peer.hasDirectLink ? 1 : 0}`;
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
