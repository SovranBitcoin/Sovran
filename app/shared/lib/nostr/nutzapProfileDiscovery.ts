/**
 * @fileoverview NIP-61 nutzap-info discovery (`kind:10019` lookup).
 *
 * Structurally the sibling of `dmRelayDiscovery.ts` — one replaceable event,
 * read from a broad discovery set, with a hard timeout — but the failure
 * semantics are the opposite. A missing `kind:10050` means "do not send"; a
 * missing `kind:10019` means only "they never published one", which is true of
 * almost everybody. So this resolver never rejects and never returns null: it
 * degrades to the identity-key assumption and flags it, and the caller warns
 * rather than refuses.
 *
 * The cache is deliberately in-memory and short-lived. This is payment-routing
 * state, not profile metadata: it must not survive an account switch, and a
 * key someone rotated is worse than one we look up again.
 */
import type { SimplePool } from 'nostr-tools/pool';

import { nostrLog } from '@/shared/lib/logger';
import {
  NUTZAP_INFO_KIND,
  readNutzapInfo,
  type NutzapProfile,
} from '@/shared/lib/nostr/nip61NutzapProfile';

/** The slice of `SimplePool` a discovery lookup needs. */
export type NutzapDiscoveryPool = Pick<SimplePool, 'get'>;

/** How long to wait for a `kind:10019` before treating it as absent. */
const DEFAULT_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * How long a resolved profile is reused. Short, because the whole point of the
 * key is that the holder can rotate it.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Bounded so a session that pays many people cannot grow it without limit. */
const CACHE_MAX_ENTRIES = 50;

interface CacheEntry {
  profile: NutzapProfile;
  fetchedAtMs: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Drop everything we know about where people want ecash locked.
 *
 * Called when the payment context is cleared — most importantly on a profile
 * switch, where reusing the previous account's lookups would be leaking one
 * identity's payment intent into another's.
 */
export function clearNutzapProfileCache(): void {
  if (cache.size === 0) return;
  nostrLog.info('nostr.nutzapProfile.cacheCleared', { entries: cache.size });
  cache.clear();
}

function readCache(pubkey: string, now: number): NutzapProfile | null {
  const entry = cache.get(pubkey);
  if (!entry) return null;
  if (now - entry.fetchedAtMs > CACHE_TTL_MS) {
    cache.delete(pubkey);
    return null;
  }
  return entry.profile;
}

function writeCache(pubkey: string, profile: NutzapProfile, now: number): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(pubkey, { profile, fetchedAtMs: now });
}

/**
 * Resolves where a pubkey wants its ecash locked.
 *
 * Absence, a malformed event and a failed lookup all resolve to the same
 * identity-key fallback with `source: 'identityFallback'`. That single shape
 * IS the "we could not confirm they can unlock this" signal — there is no
 * second nullable path for a caller to forget to handle.
 */
export function createNutzapProfileResolver(deps: {
  openPool: () => NutzapDiscoveryPool;
  discoveryRelays: readonly string[];
  timeoutMs?: number;
  now?: () => number;
}): (pubkeyHex: string) => Promise<NutzapProfile> {
  const clock = deps.now ?? (() => Date.now());
  return async function resolveNutzapProfile(pubkeyHex) {
    const cached = readCache(pubkeyHex, clock());
    if (cached) return cached;

    const pool = deps.openPool();
    let profile: NutzapProfile;
    try {
      const event = await pool.get(
        [...deps.discoveryRelays],
        { kinds: [NUTZAP_INFO_KIND], authors: [pubkeyHex] },
        { maxWait: deps.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS }
      );
      profile = readNutzapInfo(event, pubkeyHex);
      nostrLog.info('nostr.nutzapProfile.resolved', {
        pubkeyPreview: pubkeyHex.slice(0, 12) + '…',
        found: !!event,
        source: profile.source,
        mintCount: profile.mints.length,
        relayCount: profile.relays.length,
      });
    } catch (error) {
      profile = readNutzapInfo(null, pubkeyHex);
      nostrLog.warn('nostr.nutzapProfile.lookupFailed', {
        pubkeyPreview: pubkeyHex.slice(0, 12) + '…',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    writeCache(pubkeyHex, profile, clock());
    return profile;
  };
}
