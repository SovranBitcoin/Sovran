import { nip19 } from 'nostr-tools';

import { nostrLog } from '../logger';

/**
 * Converts an npub-encoded Nostr public key to its hex representation.
 * Returns the input unchanged if it doesn't start with 'npub'.
 */
export function npubToPubkey(npub: string): string {
  if (!npub) return '';

  if (npub.startsWith('npub')) {
    try {
      const data = nip19.decode(npub);
      if (data.type === 'npub') {
        nostrLog.debug('nostr.client.npub_to_pubkey', { inputLen: npub.length, type: data.type });
        return data.data;
      }
    } catch (err) {
      nostrLog.warn('nostr.client.npub_to_pubkey.decode_failed', {
        inputLen: npub.length,
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }
  return npub;
}
