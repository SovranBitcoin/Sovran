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
  // Background execution (iOS background-task assertions; Android no-ops)
  beginBLEBackgroundTask,
  endBLEBackgroundTask,
  addBLEBackgroundTaskExpiringListener,
  // Bluetooth helpers
  requestEnableBluetooth,
  openBluetoothSettings,
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
  BitchatBLEIdentityMaterial,
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
