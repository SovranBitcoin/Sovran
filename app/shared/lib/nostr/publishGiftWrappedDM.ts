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
import type { VerifiedEvent } from 'nostr-tools/pure';

import { buildGiftWrappedDMPair } from './nip17';
import { nostrLog } from '@/shared/lib/logger';
import { DM_RELAY_LIST_KIND, readDmRelays } from './outbox/nip17DmRelays';
import { publishEvent } from './publish';
import { NoDirectMessageRelaysError } from './sendDirectMessage';

const DM_RELAY_LOOKUP_TIMEOUT_MS = 3_000;

async function resolveRecipientDmRelays(
  client: NostrClient,
  recipientPublicKey: string
): Promise<string[]> {
  const discoveryRelays = client.relayUrls();
  if (discoveryRelays.length === 0 || typeof client.queryRelay !== 'function') return [];

  const settled = await Promise.allSettled(
    discoveryRelays.map((url) =>
      client.queryRelay(
        url,
        [{ kinds: [DM_RELAY_LIST_KIND], authors: [recipientPublicKey], limit: 5 }],
        DM_RELAY_LOOKUP_TIMEOUT_MS
      )
    )
  );

  let newest: VerifiedEvent | null = null;
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    for (const event of res.value.events) {
      if (event.kind !== DM_RELAY_LIST_KIND || event.pubkey !== recipientPublicKey) continue;
      if (!newest || event.created_at > newest.created_at) {
        newest = event;
      }
    }
  }
  return readDmRelays(newest);
}

/**
 * Build and publish a NIP-17 gift-wrapped DM pair. Resolves the recipient's
 * NIP-17 `kind:10050` DM relays and refuses with `NoDirectMessageRelaysError`
 * when none are declared (so the send flow keeps the manual copy/share handoff
 * instead of publishing live proofs to relays the recipient may never read).
 * Resolves once the recipient wrap is accepted by a relay; the self-copy
 * publish is best-effort.
 */
export async function publishGiftWrappedDM(params: {
  client: NostrClient;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  content: string;
  extraTags?: string[][];
}): Promise<{ selfWrapId: string }> {
  const { client, senderPrivateKey, recipientPublicKey, content, extraTags } = params;
  const recipientRelays = await resolveRecipientDmRelays(client, recipientPublicKey);
  if (recipientRelays.length === 0) {
    throw new NoDirectMessageRelaysError(recipientPublicKey);
  }

  const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
    content,
    senderPrivateKey,
    recipientPublicKey,
    ...(extraTags ? { extraTags } : {}),
  });

  const delivered = await publishEvent({
    client,
    event: recipientWrap,
    relays: recipientRelays,
    resolveOn: 'first-ok',
  });
  if (delivered.isErr()) {
    throw new Error(`Gift-wrapped DM was not accepted by any relay (${delivered.error.type})`);
  }
  nostrLog.info('nostr.giftWrapDM.published', {
    eventId: recipientWrap.id,
    targetedDmRelays: recipientRelays.length,
  });

  const selfCopy = await publishEvent({ client, event: senderWrap, resolveOn: 'first-ok' });
  if (selfCopy.isErr()) {
    nostrLog.warn('nostr.giftWrapDM.self_copy_failed', { error: selfCopy.error.type });
  }

  // The self-wrap id is the dedup key the sender's thread uses to reconcile an
  // optimistic local echo with the server copy eventually returned.
  return { selfWrapId: senderWrap.id };
}
