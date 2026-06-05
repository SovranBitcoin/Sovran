/**
 * Client-side decryption of DM envelopes fetched from nagg. This reuses the
 * EXACT proven crypto path from `useRecentContacts` — `unwrapGiftWrap` plus the
 * persistent `giftWrapCache` — so no new cryptography is introduced. Focused on
 * NIP-17 gift wraps (kind 1059 → inner kind-14 chat rumor), the dominant DM
 * format; legacy NIP-04 (kind 4) stays on the relay path for now.
 */
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';
import type { DmEnvelope } from './dmEnvelopeClient';

export interface DecryptedDm {
  /** Gift-wrap event id. */
  id: string;
  /** The other party's pubkey (the conversation key). */
  counterparty: string;
  senderPubkey: string;
  content: string;
  /** Real send time (unix seconds) from the inner rumor. */
  createdAt: number;
  isOwn: boolean;
  protocol: 'nip17';
}

/**
 * Decrypt + bucket a batch of envelopes. Mirrors the unwrap loop in
 * `useRecentContacts`: L1 cache hit → skip the NIP-44 decrypts; only kind-14
 * chat rumors are kept; the counterparty is the non-viewer party.
 */
export function decryptDmEnvelopes(
  envelopes: DmEnvelope[],
  viewerPubkey: string,
  viewerPrivateKey: Uint8Array
): DecryptedDm[] {
  const out: DecryptedDm[] = [];
  for (const envelope of envelopes) {
    if (envelope.kind !== 1059) continue;
    const cached = giftWrapCache.cache.get(viewerPubkey, envelope.id);
    const unwrapped =
      cached ?? unwrapGiftWrap({ content: envelope.content, pubkey: envelope.pubkey }, viewerPrivateKey);
    if (!unwrapped) continue;
    if (!cached) giftWrapCache.cache.put(viewerPubkey, envelope.id, unwrapped);
    if (unwrapped.kind !== 14) continue;

    const counterparty =
      unwrapped.senderPubkey === viewerPubkey
        ? unwrapped.recipientPubkeys[0]
        : unwrapped.senderPubkey;
    if (!counterparty) continue;

    out.push({
      id: envelope.id,
      counterparty,
      senderPubkey: unwrapped.senderPubkey,
      content: unwrapped.content,
      createdAt: unwrapped.created_at,
      isOwn: unwrapped.senderPubkey === viewerPubkey,
      protocol: 'nip17',
    });
  }
  return out;
}
