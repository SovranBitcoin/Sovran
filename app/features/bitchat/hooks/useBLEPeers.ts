import { create } from 'zustand';
import type { BLEPeer } from 'bitchat-module';

/** Account-scoped discovery is owned by BitchatBLEProvider, never a screen. */
export const useBLEPeerDirectory = create<{ peers: BLEPeer[] }>(() => ({ peers: [] }));
export function useBLEPeers() {
  const peers = useBLEPeerDirectory((state) => state.peers);
  return { peers, connectedCount: peers.filter((peer) => peer.isConnected).length };
}
