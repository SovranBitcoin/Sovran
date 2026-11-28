import { defineStore as create } from '@/shared/lib/persist/defineStore';
import type { BLEPeer } from 'bitchat-module';

/** Filled by the account's discovery owner while a view holds the nearby radio. */
export const useBLEPeerDirectory = create<{ peers: BLEPeer[] }>({
  name: 'useBLEPeerDirectory',
  scope: 'session',
})(() => ({ peers: [] }));
export function useBLEPeers() {
  const peers = useBLEPeerDirectory((state) => state.peers);
  return { peers, connectedCount: peers.filter((peer) => peer.isConnected).length };
}
