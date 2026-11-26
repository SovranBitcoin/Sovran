/**
 * @fileoverview Dynamic relay-pool seeding for the account's `NostrClient`.
 *
 * The client starts with a static relay set so init stays fast. Once the
 * active profile's NIP-65 list hydrates, `seedPool` makes sure those relays
 * (∪ the defaults) are present in the pool so reads reach the user's chosen
 * relays.
 *
 * Additive only: it never removes relays. Writes target explicit relay sets
 * via `resolveWriteRelays` anyway, so a lingering read relay is harmless.
 */
import type { NostrClient } from 'nostr/client';

import { nostrLog } from '@/shared/lib/logger';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';

/** Adds any of `relayUrls` (∪ defaults) missing from the pool. Returns added urls. */
export function seedPool(client: NostrClient, relayUrls: readonly string[]): string[] {
  const added = client.ensureRelays([...relayUrls, ...DEFAULT_RELAYS]);
  if (added.length > 0) nostrLog.info('nostr.relays.seeded', { added: added.length });
  return added;
}
