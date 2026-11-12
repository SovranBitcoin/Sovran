export {
  // BLE Mesh
  startBLE,
  stopBLE,
  acquirePublicBLEMesh,
  isPublicBLEMesh,
  sendBLEMessage,
  startBLEPrivateChat,
  sendBLEPrivateMessage,
  getBLEPeers,
  getBLEState,
  addBLEMessageListener,
  addBLEPrivateMessageListener,
  addBLEDeliveryStatusListener,
  addBLEPeerListener,
  addBLEStateListener,
  // Background execution (iOS background-task assertions; Android no-ops)
  beginBLEBackgroundTask,
  endBLEBackgroundTask,
  // Bluetooth helpers
  requestEnableBluetooth,
  openBluetoothSettings,
  // Nostr (native)
  startNostr,
  joinGeohash,
  sendGeohashMessage,
  sendGeohashPrivateMessage,
  addNostrMessageListener,
  addNostrPrivateMessageListener,
} from './src/BitChatModule';

export { encodeGeohash, isValidGeohash } from './src/geohash';

export type {
  BitchatBLEIdentityMaterial,
  BLEDeliveryStatus,
  BLEDeliveryStatusEvent,
  BLEMessageEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPrivateMessageEvent,
  ChatMessage,
  LocationTier,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './src/types';
