/**
 * Client-side decryption of DM envelopes fetched from nagg. nagg is
 * zero-knowledge — it returns raw encrypted events and the client decrypts and
 * buckets them by counterparty. Two protocols are handled:
 *   - NIP-17 gift wraps (kind 1059 → inner kind-14 chat rumor) via the proven
 *     `unwrapGiftWrap` + persistent `giftWrapCache` path.
 *   - NIP-04 legacy DMs (kind 4) via `nip04.decrypt` + persistent `nip04Cache`.
 * Both reuse the existing crypto; no new primitives are introduced here.
 */
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';
import { decryptNip04 } from '@/shared/lib/nostr/nip04';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import type { DmEnvelope } from './dmEnvelopeTypes';

export type DmProtocol = 'nip04' | 'nip17';

export interface DecryptedDm {
  /** Source event id (gift-wrap id for NIP-17, kind-4 event id for NIP-04). */
  id: string;
  /** The other party's pubkey (the conversation key). */
  counterparty: string;
  senderPubkey: string;
  content: string;
  /** Send time (unix seconds): inner rumor time for NIP-17, event time for NIP-04. */
  createdAt: number;
  isOwn: boolean;
  protocol: DmProtocol;
}

function pTagValue(tags: string[][]): string | undefined {
  return tags.find((t) => t[0] === 'p')?.[1];
}

function envelopeCreatedAt(envelope: DmEnvelope): number {
  const raw = envelope.createdAt;
  if (raw instanceof Date) return Math.floor(raw.getTime() / 1000);
  // nagg returns `createdAt` as a number OR a string (numeric or ISO-8601);
  // normalize all of them to unix seconds. A numeric value above the
  // milliseconds threshold is downscaled. The previous `Number(raw)` path
  // produced NaN -> 0 (epoch / 1970) for ISO-string timestamps, which is why
  // NIP-04 message dates rendered as 1970 (NIP-17 is unaffected — it uses the
  // decrypted inner rumor's numeric `created_at`).
  if (typeof raw === 'number') {
    return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : raw;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) return n > 1_000_000_000_000 ? Math.floor(n / 1000) : n;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/**
 * Decrypt + bucket a batch of envelopes across both protocols. The L1 caches
 * (positive + negative) short-circuit repeat work; only kind-14 chat rumors are
 * kept for NIP-17; the counterparty is the non-viewer party in each pair.
 */
export function decryptDmEnvelopes(
  envelopes: DmEnvelope[],
  viewerPubkey: string,
  viewerPrivateKey: Uint8Array
): DecryptedDm[] {
  const out: DecryptedDm[] = [];
  for (const envelope of envelopes) {
    if (envelope.kind === 1059) {
      const cached = giftWrapCache.cache.get(viewerPubkey, envelope.id);
      const unwrapped =
        cached ??
        unwrapGiftWrap({ content: envelope.content, pubkey: envelope.pubkey }, viewerPrivateKey);
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
      continue;
    }

    if (envelope.kind === 4) {
      // NIP-04 sent DMs are authored by the viewer and addressed to the
      // counterparty via the `p` tag; received DMs are authored by the
      // counterparty. The ECDH secret is symmetric, so the counterparty's
      // pubkey decrypts either direction.
      const isOwn = envelope.pubkey === viewerPubkey;
      const counterparty = isOwn ? pTagValue(envelope.tags) : envelope.pubkey;
      if (!counterparty) continue;

      if (nip04Cache.isKnownFailed(viewerPubkey, envelope.id)) continue;
      const cached = nip04Cache.get(viewerPubkey, envelope.id);
      const content =
        cached ??
        decryptNip04({
          content: envelope.content,
          counterpartyPubkey: counterparty,
          viewerPrivateKey,
        });
      if (content == null) {
        nip04Cache.markFailed(viewerPubkey, envelope.id);
        continue;
      }
      if (cached == null) nip04Cache.put(viewerPubkey, envelope.id, content);

      out.push({
        id: envelope.id,
        counterparty,
        senderPubkey: envelope.pubkey,
        content,
        createdAt: envelopeCreatedAt(envelope),
        isOwn,
        protocol: 'nip04',
      });
      continue;
    }
  }
  return out;
}
