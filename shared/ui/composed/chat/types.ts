/**
 * Slim message shape consumed by the shared chat bubble. Each chat surface
 * (BitChat geohash/DM, White Noise DM, etc.) maps its native event into this
 * type before rendering. Keeps the bubble transport-agnostic without forcing
 * every surface to share a deeper data model.
 */
export type ChatBubbleMessage = {
  id: string;
  content: string;
  /** Author pubkey — used as Avatar seed and the sender-grouping key. */
  senderPubkey: string;
  /** Optional display name shown above the bubble for non-own messages. */
  sender?: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  isOwn: boolean;
  /** Sender-side optimistic flag (e.g. "sending…"). */
  isPending?: boolean;
};
