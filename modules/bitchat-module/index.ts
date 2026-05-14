export {
  // BLE Mesh
  startBLE,
  sendBLEMessage,
  startBLEPrivateChat,
  resetBLEPrivateChat,
  sendBLEPrivateMessage,
  getBLEPeers,
  getBLEDmHistory,
  getBLEState,
  addBLEMessageListener,
  addBLEPrivateMessageListener,
  addBLEDeliveryStatusListener,
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
  BLEDeliveryStatus,
  BLEDeliveryStatusEvent,
  BLEDmContact,
  BLEMessageEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPrivateMessageEvent,
  ChatMessage,
  LocationTier,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './src/types';
