export {
  // BLE Mesh
  startBLE,
  sendBLEMessage,
  startBLEPrivateChat,
  sendBLEPrivateMessage,
  getBLEPeers,
  getBLEState,
  addBLEMessageListener,
  addBLEPrivateMessageListener,
  addBLEPeerListener,
  addBLEStateListener,
  // Nostr (native)
  startNostr,
  joinGeohash,
  leaveGeohash,
  sendGeohashMessage,
  sendGeohashPrivateMessage,
  addNostrMessageListener,
  addNostrPrivateMessageListener,
} from './src/BitChatModule';

export { encodeGeohash, isValidGeohash } from './src/geohash';

export type {
  BLEDiagnostics,
  BLEMessageEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPrivateMessageEvent,
  ChatMessage,
  LocationTier,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './src/types';
