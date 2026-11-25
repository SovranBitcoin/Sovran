/**
 * @fileoverview Publish a NIP-17 gift-wrapped DM (recipient wrap + self-copy)
 * through the account's Nostr client.
 *
 * One kind-1059 wrap addressed to the recipient, and one self-copy wrap so the
 * sender can retrieve their own sent message. The self-copy is what makes a
 * sent token show up in the sender's own DM thread.
 *
 * Used by the Send flow to deliver a bearer ecash token to a remote Nostr
 * contact: the encrypted gift wrap keeps the token private to the recipient's
 * npub, so a bearer token is safe to send this way (unlike a public broadcast).
 */

import type { NostrClient } from 'nostr/client';

import { buildGiftWrappedDMPair } from './nip17';
import { nostrLog } from '@/shared/lib/logger';
import { publishEvent } from './publish';

/**
 * Build and publish a NIP-17 gift-wrapped DM pair. Resolves once the recipient
 * wrap is accepted by a relay; the self-copy publish is best-effort (its failure
 * only costs the local thread echo, not delivery). Rejects if the recipient wrap
 * fails to publish — callers MUST treat a rejection as "not delivered" and keep
 * the funds recoverable (do not navigate away as if it succeeded).
 */
export async function publishGiftWrappedDM(params: {
  client: NostrClient;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  content: string;
  extraTags?: string[][];
}): Promise<{ selfWrapId: string }> {
  const { client, senderPrivateKey, recipientPublicKey, content, extraTags } = params;
  const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
    content,
    senderPrivateKey,
    recipientPublicKey,
    ...(extraTags ? { extraTags } : {}),
  });

  const delivered = await publishEvent({ client, event: recipientWrap, resolveOn: 'first-ok' });
  if (delivered.isErr()) {
    throw new Error(`Gift-wrapped DM was not accepted by any relay (${delivered.error.type})`);
  }
  nostrLog.info('nostr.giftWrapDM.published', { eventId: recipientWrap.id });

  const selfCopy = await publishEvent({ client, event: senderWrap, resolveOn: 'first-ok' });
  if (selfCopy.isErr()) {
    nostrLog.warn('nostr.giftWrapDM.self_copy_failed', { error: selfCopy.error.type });
  }

  // The self-wrap id is the dedup key the sender's thread uses to reconcile an
  // optimistic local echo with the server copy nagg eventually returns.
  return { selfWrapId: senderWrap.id };
}
