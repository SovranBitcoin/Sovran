/**
 * Transport-agnostic chat-message shape used by `useBitChat`. The same shape
 * carries BLE-mesh and Nostr-geohash messages, which means `senderId` is NOT
 * a single semantic kind — it's whichever stable per-sender identifier the
 * source transport gives us:
 *
 *   - BLE public chat:  `senderPeerID` (16-hex BLE peer ID)
 *   - BLE DM:           `peerID` (16-hex BLE peer ID)
 *   - Nostr public:     per-geohash Nostr hex pubkey
 *   - Nostr DM:         per-geohash Nostr hex pubkey
 *   - Own (echoed):     `''` — empty string keeps `useMessageGrouping` from
 *                       conflating own + peer runs at side switches
 *
 * Used downstream as an Avatar seed and as the sender-grouping key — never as
 * a Nostr pubkey at the protocol layer. Protocol-truth pubkeys live on
 * `NostrMessageEvent.senderPubkey` / `NostrPrivateMessageEvent.senderPubkey`.
 */
export interface ChatMessage {
  id: string;
  content: string;
  sender: string;
  senderId: string;
  timestamp: number;
  isPrivate: boolean;
  isOwn: boolean;
  /**
   * Sender-side optimistic flag: `true` between dispatch and transport ack
   * (BLE acked from native, or `sendGeohashMessage`/`sendGeohashPrivateMessage`
   * resolves on the JS side). Cleared once the send succeeds; the optimistic
   * row is removed on failure. Non-own messages leave it unset.
   */
  isPending?: boolean;
}

export interface LocationTier {
  key: string;
  label: string;
  precision: number;
  geohash: string;
}

// --- BLE bridge payloads ---

export interface BLEPeer {
  peerID: string;
  nickname: string;
  isConnected: boolean;
  lastSeen: number;
}

export interface BLEMessageEvent {
  id: string;
  content: string;
  sender: string;
  senderPeerID: string;
  timestamp: number;
  isPrivate: boolean;
}

/**
 * Payload dispatched on the `onBLEPrivateMessage` event. A Noise-encrypted
 * 1:1 BLE mesh DM that BitChatBLEBridge decrypted + unwrapped. `peerID` is
 * the 16-hex upstream PeerID — use it to route the message into the right
 * DM thread. `sender` is the best-effort nickname (falls back to pubkey
 * prefix if we haven't seen an announce from this peer yet).
 */
export interface BLEPrivateMessageEvent {
  id: string;
  peerID: string;
  sender: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
}

/**
 * Payload dispatched on the `onBLEPeerUpdate` event. The native bridge sends
 * a fresh peer snapshot whenever announce-state changes (new peer, peer
 * dropped, nickname change). Consumers may receive a single peer or a list —
 * the bridge normalises to one event per change.
 */
export interface BLEPeerEvent {
  peerID: string;
  nickname?: string;
  isConnected?: boolean;
  lastSeen?: number;
}

export interface BLEDiagnostics {
  isRunning: boolean;
  centralState: string;
  peripheralState: string;
  isScanning: boolean;
  isAdvertising: boolean;
  /** Peers tracked via announce-packet exchange (post-Noise-handshake). */
  peerCount: number;
  connectedPeers: number;
  /** CBPeripheral instances we're connected to as central (pre-announce). */
  connectedPeripherals: number;
  /**
   * Subset of connectedPeripherals where we completed characteristic discovery
   * and called setNotifyValue(true). The remote device's `updateValue`
   * notifications only reach us for peripherals in this count.
   */
  peripheralsSubscribed: number;
  /** CBCentral instances subscribed to our peripheral characteristic. */
  subscribedCentrals: number;
  /** Inbound writes being accumulated from centrals (long-write reassembly). */
  pendingWriteBuffers: number;
  /** Same as peerCount but raw — drift indicates tracking bugs. */
  announcedPeers: number;
  /**
   * Count of `peripheral(_:didUpdateValueFor:error:)` delegate callbacks since
   * start. 0 while peripheralsSubscribed ≥ 1 means the remote never notifies
   * us — a discovery / setNotifyValue / characteristic-property problem.
   */
  inboundNotifyCount: number;
  /** Subset of inboundNotifyCount where the delegate fired with a non-nil error. */
  inboundNotifyErrorCount: number;
  /** Subset of inboundNotifyCount where the characteristic value was nil or empty. */
  inboundNotifyEmptyCount: number;
  /**
   * Gate counters inside `handleAnnounce`. `announceReceivedCount` ticks every
   * time an announce packet enters the function. The other six track which
   * early-return gate fired; sum should roughly equal received - accepted.
   *
   * If announceReceivedCount > 0 and announceAcceptedCount stays 0, one of the
   * reject counters will reveal which gate is dropping. Most likely: sig fail
   * (protocol divergence) or unverified (unsigned announces from a peer we
   * don't have keys for).
   */
  announceReceivedCount: number;
  announceDecodeFailCount: number;
  announceSenderMismatchCount: number;
  announceStaleCount: number;
  announceSigFailCount: number;
  announceUnverifiedCount: number;
  announceAcceptedCount: number;
  /**
   * DM pipeline counters. Ticks when we hand a DM off to BLEService for
   * encryption/broadcast. Non-zero on sender + zero on recipient ⇒ send
   * reached the native layer but never reached the peer (handshake stuck,
   * peer not directly connected, etc.).
   */
  sentPrivateMessageCount: number;
  /**
   * Ticks on every decrypted inbound Noise payload regardless of type. Zero
   * here when the peer is sending you DMs means either no packet arrived
   * or upstream's `handleNoiseEncrypted` couldn't decrypt it (session not
   * established, nonce mismatch).
   */
  receivedNoisePayloadCount: number;
  /**
   * Ticks only for `.privateMessage` typed Noise payloads that decoded
   * successfully. If this stays 0 while `receivedNoisePayloadCount` climbs,
   * the payload shape diverged (wrong NoisePayloadType or TLV decode fail).
   */
  receivedPrivateMessageCount: number;
}

// --- Nostr bridge payloads ---

/**
 * Payload dispatched on the `onNostrMessage` event from BitChatNostrBridge.
 * `senderPubkey` is the per-geohash-derived pubkey, NOT the user's main npub.
 */
export interface NostrMessageEvent {
  id: string;
  content: string;
  sender: string;
  senderPubkey: string;
  timestamp: number;
  geohash: string;
  isOwn: boolean;
}

/**
 * Payload dispatched on the `onNostrPrivateMessage` event. A NIP-17 gift
 * wrap addressed to our per-geohash derived Nostr pubkey, unwrapped +
 * BitChat-inner decoded by BitChatNostrBridge. `senderPubkey` is the
 * rumor's pubkey — the sender's per-geohash identity. Route by this pubkey.
 */
export interface NostrPrivateMessageEvent {
  id: string;
  senderPubkey: string;
  sender: string;
  content: string;
  timestamp: number;
  geohash: string;
  isOwn: boolean;
}
