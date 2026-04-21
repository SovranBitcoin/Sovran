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
  startBLEPrivateChat,
  sendBLEPrivateMessage,
  getBLEPeers,
  getBLEState,
  getBLEDiagnostics,
  addBLEMessageListener,
  addBLEPrivateMessageListener,
  addBLEPeerListener,
  addBLEStateListener,
  // Nostr (native)
  startNostr,
  stopNostr,
  joinGeohash,
  leaveGeohash,
  sendGeohashMessage,
  sendGeohashPrivateMessage,
  addNostrMessageListener,
  addNostrPrivateMessageListener,
} from './src/BitChatModule';

export type { BLEPeer, BLEMessageEvent, BLEDiagnostics } from './src/BitChatModule';

export { encodeGeohash, decodeGeohash, isValidGeohash } from './src/geohash';

export type {
  ChatMessage,
  Participant,
  RelayStatus,
  LocationTier,
  NostrMessageEvent,
  BLEPrivateMessageEvent,
  NostrPrivateMessageEvent,
  BitChatEventMap,
} from './src/types';
