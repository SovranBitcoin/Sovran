export {
  // Geohash
  nativeEncodeGeohash,
  nativeDecodeGeohash,
  getNeighbors,
  getClosestRelays,
  getClosestRelaysForGeohash,
  // BLE Mesh
  startBLE,
  stopBLE,
  sendBLEMessage,
  getBLEPeers,
  getBLEState,
  getBLEDiagnostics,
  addBLEMessageListener,
  addBLEPeerListener,
  addBLEStateListener,
  // Nostr (native)
  startNostr,
  stopNostr,
  joinGeohash,
  leaveGeohash,
  sendGeohashMessage,
  addNostrMessageListener,
} from './src/BitChatModule';

export type { BLEPeer, BLEMessageEvent, BLEDiagnostics } from './src/BitChatModule';

export { encodeGeohash, decodeGeohash, isValidGeohash } from './src/geohash';

export type {
  ChatMessage,
  Participant,
  RelayStatus,
  LocationTier,
  NostrMessageEvent,
  BitChatEventMap,
} from './src/types';
