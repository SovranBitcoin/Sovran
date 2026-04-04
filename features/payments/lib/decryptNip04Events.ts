import { NDKEvent, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk-mobile';
import { nostrLog } from '@/shared/lib/logger';

/**
 * Decrypt NIP-04 DM events for a list of items sharing { pubkey, dmEvent, nip17Content? }.
 * NIP-17 messages are already decrypted during unwrapping and passed through via nip17Content.
 */
export async function decryptNip04Events<
  T extends { pubkey: string | null; dmEvent?: any; nip17Content?: string },
>(items: T[], privateKey: Uint8Array): Promise<T[]> {
  nostrLog.info('nostr.nip04.decrypt.start', { itemCount: items.length });
  const start = performance.now();
  const signer = new NDKPrivateKeySigner(privateKey);
  const results: T[] = [];
  let decryptedCount = 0;
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
        const counterparty = new NDKUser({ pubkey: item.pubkey });
        await item.dmEvent.decrypt(counterparty, signer);
        results.push({ ...item, dmEvent: { ...item.dmEvent, content: item.dmEvent.content } });
        decryptedCount++;
      } else {
        results.push(item);
        skippedCount++;
      }
    } catch (error) {
      nostrLog.warn('nostr.nip04.decrypt.item_failed', { pubkey: item.pubkey?.slice(0, 8), error });
      results.push({ ...item, dmEvent: { ...item.dmEvent, content: '[Encrypted message]' } });
      failedCount++;
    }
  }

  nostrLog.info('nostr.nip04.decrypt.done', {
    total: items.length,
    decrypted: decryptedCount,
    nip17Passthrough: nip17Count,
    skipped: skippedCount,
    failed: failedCount,
    duration_ms: Math.round((performance.now() - start) * 100) / 100,
  });
  return results;
}
