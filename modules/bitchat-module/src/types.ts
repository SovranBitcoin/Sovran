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
