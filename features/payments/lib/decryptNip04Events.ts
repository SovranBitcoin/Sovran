import { NDKEvent, NDKPrivateKeySigner, NDKUser } from '@nostr-dev-kit/ndk-mobile';

/**
 * Decrypt NIP-04 DM events for a list of items sharing { pubkey, dmEvent, nip17Content? }.
 * NIP-17 messages are already decrypted during unwrapping and passed through via nip17Content.
 */
export async function decryptNip04Events<
  T extends { pubkey: string | null; dmEvent?: any; nip17Content?: string },
>(items: T[], privateKey: Uint8Array): Promise<T[]> {
  const signer = new NDKPrivateKeySigner(privateKey);
  const results: T[] = [];

  for (const item of items) {
    try {
      if (item.nip17Content !== undefined) {
        results.push({ ...item, dmEvent: { content: item.nip17Content } });
        continue;
      }
      if (!item.dmEvent || !item.pubkey) {
        results.push(item);
        continue;
      }
      if (item.dmEvent instanceof NDKEvent) {
        const counterparty = new NDKUser({ pubkey: item.pubkey });
        await item.dmEvent.decrypt(counterparty, signer);
        results.push({ ...item, dmEvent: { ...item.dmEvent, content: item.dmEvent.content } });
      } else {
        results.push(item);
      }
    } catch {
      results.push({ ...item, dmEvent: { ...item.dmEvent, content: '[Encrypted message]' } });
    }
  }
  return results;
}
