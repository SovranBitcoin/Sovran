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

export interface BitchatBLEIdentityMaterial {
  version: 'sovran-bitchat-ble-v1';
  nostrPubkey: string;
  noisePrivateKeyHex: string;
  signingPrivateKeyHex: string;
}

export interface BLEPeer {
  peerID: string;
  nickname: string;
  /**
   * Cached announce-time reachability. True if the most recent announce was
   * direct OR we had a peripheral/central connection at announce-time. Stays
   * true after the BLE radio link silently dies — so do NOT use this alone
   * to decide whether a DM can be delivered. Prefer `hasDirectLink`.
   */
  isConnected: boolean;
  /**
   * Real-time check: do we currently have a direct peripheral or central
   * link to this peer? When `false`, outbound encrypted DMs fall through to
   * mesh-flood with a 15-second spool window — if the peer isn't reachable
   * via some intermediary in that window, the message is silently dropped
   * (upstream has no further retry).
   */
  hasDirectLink: boolean;
  lastSeen: number;
  /**
   * True when the peer's last verified announce carried the v2 capability
   * beacon with the NUT-requests bit — the peer answers NUT-18
   * payment-request solicits over the Noise channel (vendor payloads
   * 0xA0–0xA3). Authentic to the announcing peer (announces are
   * Ed25519-signed) but any client could claim it — treat as a feature
   * gate, not a trust signal.
   */
  supportsNutRequests: boolean;
  /**
   * v2 beacon bit 1: the peer auto-redeems received ecash. Informational —
   * drives the radar "instant" badge.
   */
  autoRedeem: boolean;
  /**
   * The peer's announced Curve25519 noise static key (64-hex) — bitchat's
   * own identity, present for EVERY peer including stock clients. A stable
   * pseudonym seed for identicons/word-pair names across nickname changes.
   * NOT a Nostr pubkey: never use it for kind-0 profile lookups.
   */
  noisePublicKeyHex?: string;
}

/**
 * Payload dispatched on the `onNutPayload` event: a Nut Drop vendor Noise
 * payload (0xA0–0xA3) decrypted by the vendored mesh stack. `payload` is the
 * full typed bytes (type byte included) — decode with `nutDropProtocol.ts`.
 */
export interface BLENutPayloadEvent {
  peerID: string;
  payload: Uint8Array;
  timestamp: number;
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
 * Stable status strings emitted by `onBLEDeliveryStatus`. Map cleanly to
 * the native `DeliveryStatus` enum (see DeliveryStatus.swift):
 *   - `sending`            — queued; waiting for Noise handshake to complete
 *   - `sent`               — encrypted + broadcast to BLE
 *   - `delivered`          — recipient acked decryption (nickname populated)
 *   - `read`               — recipient opened the chat (nickname populated)
 *   - `failed`             — encryption / encode failure (`reason` populated)
 *   - `partiallyDelivered` — group/room broadcast where some recipients missed
 */
export type BLEDeliveryStatus =
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'partiallyDelivered';

/**
 * Payload of the `onBLEDeliveryStatus` event. Use `messageID` to look up the
 * optimistic message that was added to the local chat buffer at send time.
 */
export interface BLEDeliveryStatusEvent {
  messageID: string;
  status: BLEDeliveryStatus;
  /** Counterparty nickname, only populated for `delivered` / `read`. */
  nickname?: string;
  /** Free-form reason or "<reached>/<total>" for partial deliveries. */
  reason?: string;
}

/**
 * Persisted summary of a BLE-mesh 1:1 chat counterparty. Returned by
 * `getBLEDmHistory(profileScope)` — used to surface peers we've previously
 * DM'd in the Contacts screen's Recent / All tabs even after the app has been killed.
 * `nickname` may be `''` if we never received an announce with one.
 */
export interface BLEDmContact {
  peerID: string;
  nickname: string;
  lastTimestamp: number;
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
