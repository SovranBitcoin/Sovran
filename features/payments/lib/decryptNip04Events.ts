import { NDKEvent, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk-mobile';
import { nostrLog } from '@/shared/lib/logger';
import {
  getCachedNip04Plaintext,
  isKnownFailedNip04,
  markNip04Failed,
  putNip04Plaintext,
} from '@/shared/lib/nostr/nip04Cache';

interface DecryptNip04EventsOptions {
  privateKey: Uint8Array;
  /** Active profile pubkey — scopes the persistent plaintext cache. */
  recipientPubkey: string;
}

/**
 * Decrypt NIP-04 DM events. NIP-17 messages are passed through via
 * `nip17Content` (already decrypted during unwrap). Cache hits on the
 * persistent NIP-04 plaintext store skip the ECDH + AES-CBC cost.
 */
export async function decryptNip04Events<
  T extends { pubkey: string | null; dmEvent?: any; nip17Content?: string },
>(items: T[], opts: DecryptNip04EventsOptions): Promise<T[]> {
  const { privateKey, recipientPubkey } = opts;
  nostrLog.info('nostr.nip04.decrypt.start', { itemCount: items.length });
  const start = performance.now();
  // Defer signer creation until we actually need to decrypt
  let signer: NDKPrivateKeySigner | null = null;
  const results: T[] = [];
  let decryptedCount = 0;
  let cacheHitCount = 0;
  let nip17Count = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    try {
      if (item.nip17Content !== undefined) {
        results.push({ ...item, dmEvent: { content: item.nip17Content } });
        nip17Count++;
        continue;
      }
      if (!item.dmEvent || !item.pubkey) {
        results.push(item);
        skippedCount++;
        continue;
      }
      if (item.dmEvent instanceof NDKEvent) {
        const eventId = item.dmEvent.id;
        // Negative-cache hit: known-bad event, render as encrypted
        // placeholder without burning the ECDH + AES-CBC cost again.
        if (eventId && isKnownFailedNip04(recipientPubkey, eventId)) {
          results.push({ ...item, dmEvent: { ...item.dmEvent, content: '[Encrypted message]' } });
          failedCount++;
          continue;
        }
        // Positive-cache hit: skip decrypt, return a fresh wrapper with
        // the cached plaintext. Don't mutate caller's `item.dmEvent` —
        // NDKEvent instances are owned by the @nostr-dev-kit subscription
        // and seeing their content swap underfoot triggers downstream
        // re-renders we don't own.
        const cached = eventId ? getCachedNip04Plaintext(recipientPubkey, eventId) : undefined;
        if (cached !== undefined) {
          results.push({ ...item, dmEvent: { ...item.dmEvent, content: cached } });
          cacheHitCount++;
          continue;
        }
        if (!signer) signer = new NDKPrivateKeySigner(privateKey);
        const counterparty = new NDKUser({ pubkey: item.pubkey });
        await item.dmEvent.decrypt(counterparty, signer);
        if (eventId) putNip04Plaintext(recipientPubkey, eventId, item.dmEvent.content);
        results.push({ ...item, dmEvent: { ...item.dmEvent, content: item.dmEvent.content } });
        decryptedCount++;
      } else {
        results.push(item);
        skippedCount++;
      }
    } catch (error) {
      nostrLog.warn('nostr.nip04.decrypt.item_failed', { pubkey: item.pubkey?.slice(0, 8), error });
      const eventId = (item.dmEvent as NDKEvent | undefined)?.id;
      if (eventId) markNip04Failed(recipientPubkey, eventId);
      results.push({ ...item, dmEvent: { ...item.dmEvent, content: '[Encrypted message]' } });
      failedCount++;
    }
  }

  nostrLog.info('nostr.nip04.decrypt.done', {
    total: items.length,
    decrypted: decryptedCount,
    cacheHits: cacheHitCount,
    nip17Passthrough: nip17Count,
    skipped: skippedCount,
    failed: failedCount,
    duration_ms: Math.round((performance.now() - start) * 100) / 100,
  });
  return results;
}
