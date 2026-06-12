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
  // Nut Drop NUT-18 exchange (vendor Noise payloads 0xA0–0xA3)
  nutSendPayload,
  nutSolicit,
  addNutPayloadListener,
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

// Pure codecs + constants for the Nut Drop payloads — also consumed by the
// colada mesh-transport adapter and the golden-vector tests.
export * from './src/nutDropProtocol';

export type {
  BitchatBLEIdentityMaterial,
  BLEDeliveryStatus,
  BLEDeliveryStatusEvent,
  BLEDmContact,
  BLEMessageEvent,
  BLENutPayloadEvent,
  BLEPeer,
  BLEPeerEvent,
  BLEPrivateMessageEvent,
  ChatMessage,
  LocationTier,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './src/types';
