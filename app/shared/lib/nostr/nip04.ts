/**
 * @fileoverview NIP-04 legacy direct messages (kind 4).
 *
 * NIP-04 is the legacy encrypted-DM scheme: a single kind-4 event whose content
 * is AES-CBC encrypted under the ECDH shared secret between sender and
 * recipient, with the recipient revealed in a `p` tag. Unlike NIP-17 there is
 * no gift wrap and no self-copy — a sent message is the viewer-authored event
 * itself, re-fetched via an `authors` filter.
 *
 * Reference: https://github.com/nostr-protocol/nips/blob/master/04.md
 */

import type { VerifiedEvent } from 'nostr-tools/core';
import { finalizeEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';

import { nostrLog } from '../logger';

const now = (): number => Math.round(Date.now() / 1000);

/**
 * Decrypt a NIP-04 ciphertext. `counterpartyPubkey` is the OTHER party — the
 * event author for a received DM, or the `p`-tagged recipient for one the
 * viewer sent (the ECDH secret is symmetric, so either resolves the same
 * shared key). Returns null on failure.
 */
export function decryptNip04(params: {
  content: string;
  counterpartyPubkey: string;
  viewerPrivateKey: Uint8Array;
}): string | null {
  try {
    return nip04.decrypt(params.viewerPrivateKey, params.counterpartyPubkey, params.content);
  } catch (error) {
    nostrLog.warn('nostr.nip04.decrypt_failed', {
      counterpartyPrefix: params.counterpartyPubkey.slice(0, 8),
      error,
    });
    return null;
  }
}
