/**
 * @fileoverview Recipient relay-list resolution + outbox composition.
 *
 * To make mentions/replies/DMs actually reach their recipients (the outbox
 * model), a write must also target each recipient's NIP-65 read relays. This
 * fetches and caches other users' `kind:10002` lists, then composes the final
 * write set via the pure `resolveWriteRelays`.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { parseRelayList, readRelays, RELAY_LIST_KIND } from '@/shared/lib/nostr/outbox/nip65';
import {
  resolveWriteRelays,
  type RecipientRelays,
} from '@/shared/lib/nostr/outbox/resolveWriteRelays';

const TTL_MS = 10 * 60 * 1000; // 10 min
const cache = new Map<string, { readRelays: string[]; at: number }>();

/** Fetches (cache-first) a pubkey's NIP-65 read relays. `[]` when unknown. */
async function getRecipientReadRelays(ndk: NDK, pubkey: string): Promise<string[]> {
  const cached = cache.get(pubkey);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.readRelays;

  try {
    const event = await ndk.fetchEvent({ kinds: [RELAY_LIST_KIND], authors: [pubkey] });
    const reads = event ? readRelays(parseRelayList({ tags: event.tags })) : [];
    cache.set(pubkey, { readRelays: reads, at: Date.now() });
    return reads;
  } catch {
    nostrLog.warn('nostr.relays.recipient_fetch_failed', { pubkey: pubkey.slice(0, 8) });
    cache.set(pubkey, { readRelays: [], at: Date.now() });
    return [];
  }
}

export interface OutboxInput {
  ownWriteRelays: readonly string[];
  /** Pubkeys (mentions/recipients) whose read relays the event should reach. */
  mentionPubkeys?: readonly string[];
  hintRelays?: readonly string[];
}

/**
 * Resolves the outbox-aware write set: the author's write relays plus each
 * recipient's read relays (fetched cache-first), composed/capped by
 * `resolveWriteRelays`.
 */
export async function resolveOutboxRelays(ndk: NDK, input: OutboxInput): Promise<string[]> {
  const recipients: RecipientRelays[] = await Promise.all(
    (input.mentionPubkeys ?? []).map(async (pubkey) => ({
      pubkey,
      readRelays: await getRecipientReadRelays(ndk, pubkey),
    }))
  );
  return resolveWriteRelays({
    ownWriteRelays: input.ownWriteRelays,
    recipients,
    hintRelays: input.hintRelays,
  });
}
