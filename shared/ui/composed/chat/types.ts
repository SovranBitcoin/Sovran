/**
 * Slim message shape consumed by the shared chat bubble. Each chat surface
 * (BitChat geohash/DM, White Noise DM, Nostr DM) maps its native event into
 * this type before rendering. Keeps the bubble transport-agnostic without
 * forcing every surface to share a deeper data model.
 */
/**
 * Args passed to a ChatScreen `renderBubble` override. Lets a surface take
 * over rendering of an individual message while keeping the shared grouping
 * metadata that the default bubble would have used. AI uses this to render
 * assistant replies bubble-less while still getting first/last grouping for
 * its own user-pill bubble.
 */
export type ChatBubbleRenderArgs = {
  message: ChatBubbleMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
};

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
  /**
   * Delivery state for own messages, modelled on the standard chat-app
   * sending → sent vocabulary:
   *  - `'sending'` — optimistic dispatch in flight (spinner glyph + bubble
   *    dimmed to 60%).
   *  - `'sent'` — transport ack received (single-check glyph).
   * Non-own messages leave this field unset. None of the underlying
   * protocols (NIP-04, NIP-17, MLS, BitChat) expose a read-receipt, so the
   * vocabulary deliberately stops at 'sent' rather than introducing a
   * misleading 'read' state.
   */
  deliveryStatus?: 'sending' | 'sent';
  /**
   * Pre-extracted cashu token (cashuA…/cashuB…) found inside `content`. When
   * present, the bubble strips it from the rendered text and shows a
   * `CashuTokenBubble` redeem affordance below. Adapters call
   * `extractCashuToken(content)` to populate.
   */
  cashuToken?: string;
};
