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

import type { VerifiedEvent } from 'nostr-tools';
import { finalizeEvent, nip04 } from 'nostr-tools';

import { nostrLog } from '../logger';

const now = (): number => Math.round(Date.now() / 1000);

/**
 * Build a signed NIP-04 (kind 4) direct message addressed to
 * `recipientPublicKey`. The content is encrypted under the sender↔recipient
 * ECDH secret; the recipient is revealed in a `p` tag for relay routing.
 */
export function buildNip04DM(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
}): VerifiedEvent {
  const ciphertext = nip04.encrypt(
    params.senderPrivateKey,
    params.recipientPublicKey,
    params.content
  );
  nostrLog.debug('nostr.nip04.build_dm', {
    recipientPrefix: params.recipientPublicKey.slice(0, 8),
  });
  return finalizeEvent(
    {
      kind: 4,
      content: ciphertext,
      created_at: now(),
      tags: [['p', params.recipientPublicKey]],
    },
    params.senderPrivateKey
  ) as VerifiedEvent;
}

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
