/**
 * @fileoverview Dynamic relay-pool seeding for the app's main NDK.
 *
 * The app NDK is constructed with a static `explicitRelayUrls` set so init
 * stays fast. Once the active profile's NIP-65 list hydrates, `seedPool` makes
 * sure those relays (∪ the defaults) are present in the pool so reads reach the
 * user's chosen relays.
 *
 * Additive only: it never removes relays. Removal would risk tearing down
 * relays other subsystems added to the same pool (e.g. whitenoise inbox
 * relays), and writes target explicit relay sets via `resolveWriteRelays`
 * anyway — so a lingering read relay is harmless. The NIP-46 signer uses a
 * wholly separate NDK/pool and is never touched here.
 */
import { NDKRelay, type NDKPool } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { DEFAULT_RELAYS, normalizeRelayList } from '@/shared/lib/nostr/outbox/defaults';

/** Adds any of `relayUrls` (∪ defaults) missing from the pool. Returns added urls. */
export function seedPool(ndk: NDK, relayUrls: readonly string[]): string[] {
  const pool: NDKPool | undefined = ndk.pool;
  if (!pool) return [];

  const wanted = normalizeRelayList([...relayUrls, ...DEFAULT_RELAYS]);
  const added: string[] = [];
  for (const url of wanted) {
    if (pool.relays.has(url)) continue;
    try {
      pool.addRelay(new NDKRelay(url, undefined, ndk), true);
      added.push(url);
    } catch {
      nostrLog.warn('nostr.relays.seed_failed', { urlLength: url.length });
    }
  }
  if (added.length > 0) nostrLog.info('nostr.relays.seeded', { added: added.length });
  return added;
}
