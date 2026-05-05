/**
 * Slim message shape consumed by the shared chat bubble. Each chat surface
 * (BitChat geohash/DM, White Noise DM, Nostr DM) maps its native event into
 * this type before rendering. Keeps the bubble transport-agnostic without
 * forcing every surface to share a deeper data model.
 */
export type ChatBubbleMessage = {
  id: string;
  content: string;
  /**
   * Stable per-sender identifier — used as Avatar seed and as the
   * sender-grouping key. Transport-agnostic: it can be a Nostr hex pubkey, a
   * BLE peer-id, or `''` for own messages. Not safe to use as a Nostr pubkey
   * at the protocol layer; protocol-truth pubkeys live on the source event.
   */
  senderId: string;
  /** Optional display name shown above the bubble for non-own messages. */
  sender?: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  isOwn: boolean;
  /** Sender-side optimistic flag (e.g. "sending…"). */
  isPending?: boolean;
  /**
   * Read-receipt state for own messages. `'sending'` shows a spinner,
   * `'sent'` an empty check, `'read'` a double-check at lower opacity.
   * Non-own messages ignore this field. Distinct from `isPending` so that
   * surfaces with no read-receipt model (BitChat, MLS) can leave it unset
   * and still get optimistic-send visuals via `isPending`.
   */
  deliveryStatus?: 'sending' | 'sent' | 'read';
  /**
   * Pre-extracted cashu token (cashuA…/cashuB…) found inside `content`. When
   * present, the bubble strips it from the rendered text and shows a
   * `CashuTokenBubble` redeem affordance below. Adapters call
   * `extractCashuToken(content)` to populate.
   */
  cashuToken?: string;
};
