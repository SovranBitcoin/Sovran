export interface ChatMessage {
  id: string;
  content: string;
  sender: string;
  senderPubkey: string;
  timestamp: number;
  isPrivate: boolean;
  isOwn: boolean;
}

export interface Participant {
  peerID: string;
  nickname: string;
  pubkey: string;
  lastSeen: number;
}

export interface RelayStatus {
  url: string;
  isConnected: boolean;
  messagesSent: number;
  messagesReceived: number;
}

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

export interface LocationTier {
  key: string;
  label: string;
  precision: number;
  geohash: string;
}

export type BitChatEventMap = {
  onMessage: ChatMessage;
  onParticipantsChanged: { count: number; participants: Participant[] };
  onConnectionStateChanged: { isConnected: boolean; relayCount: number };
  onChannelChanged: { geohash: string; precision: number };
};
