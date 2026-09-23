/**
 * @fileoverview NIP-17 DM relay discovery (`kind:10050` lookup).
 *
 * Answers "where does this pubkey read direct messages?" when a NUT-18 payment
 * request's nprofile carried no relay hints of its own.
 *
 * The lookup is a read of a public, replaceable event, so it is queried from a
 * broad discovery set. That is not the same as *publishing* there: a gift wrap
 * sent to a relay the recipient never reads is ecash dropped on the floor,
 * whereas a `kind:10050` query only tells those relays we looked someone up.
 *
 * Returning `[]` means "no declared inbox". NIP-17 makes that an instruction to
 * stop, not a licence to pick relays — see `sendDirectMessage.ts`, which
 * refuses rather than guessing.
 */
import type { SimplePool } from 'nostr-tools/pool';

import { nostrLog } from '@/shared/lib/logger';
import { DM_RELAY_LIST_KIND, readDmRelays } from '@/shared/lib/nostr/outbox/nip17DmRelays';

/** The slice of `SimplePool` a discovery lookup needs. */
export type DmDiscoveryPool = Pick<SimplePool, 'get'>;

/** How long to wait for a `kind:10050` before treating it as absent. */
const DEFAULT_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Resolves a pubkey's NIP-17 DM relays. `[]` when the author has published no
 * list, when the list holds no usable url, or when the lookup fails — every one
 * of which the caller must treat as "do not send".
 *
 * A failed lookup is deliberately not distinguished from an absent list: both
 * leave us without a declared inbox, and the only safe response to either is to
 * refuse. Raising here instead would tempt a caller into a catch-and-fallback.
 */
export function createDmRelayResolver(deps: {
  openPool: () => DmDiscoveryPool;
  discoveryRelays: readonly string[];
  timeoutMs?: number;
}): (pubkey: string) => Promise<string[]> {
  return async function resolveDmRelays(pubkey) {
    const pool = deps.openPool();
    try {
      const event = await pool.get(
        [...deps.discoveryRelays],
        { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey] },
        { maxWait: deps.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS }
      );
      const relays = readDmRelays(event);
      nostrLog.info('nostr.dmRelays.resolved', {
        pubkeyPreview: pubkey.slice(0, 12) + '…',
        found: !!event,
        relayCount: relays.length,
      });
      return relays;
    } catch (error) {
      nostrLog.warn('nostr.dmRelays.lookupFailed', {
        pubkeyPreview: pubkey.slice(0, 12) + '…',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };
}
