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
import { SimplePool } from 'nostr-tools/pool';

import { nostrLog } from '@/shared/lib/logger';
import { PAYMENT_RELAYS } from '@/shared/lib/nostr/sendDirectMessage';
import {
  NUTZAP_INFO_KIND,
  readNutzapInfo,
  type NutzapProfile,
} from '@/shared/lib/nostr/nip61NutzapProfile';

/** The slice of `SimplePool` a discovery lookup needs. */
export type NutzapDiscoveryPool = Pick<SimplePool, 'get' | 'destroy'>;

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
 * Lookups still out, keyed by pubkey. Without this a prefetch and the amount
 * screen's own resolve open two relay pools for the same question, and the
 * prefetch buys nothing — the screen still waits on its own round trip.
 */
const inflight = new Map<string, Promise<NutzapProfile>>();

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
  inflight.clear();
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
  async function lookup(pubkeyHex: string): Promise<NutzapProfile> {
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
    } finally {
      pool.destroy();
    }
    writeCache(pubkeyHex, profile, clock());
    return profile;
  }

  return function resolveNutzapProfile(pubkeyHex) {
    const cached = readCache(pubkeyHex, clock());
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(pubkeyHex);
    if (pending) return pending;
    // `lookup` never rejects (absence, malformed events and relay failures all
    // resolve to the identity fallback), so the entry is cleared on settle
    // purely to bound the map.
    const started = lookup(pubkeyHex).finally(() => {
      inflight.delete(pubkeyHex);
    });
    inflight.set(pubkeyHex, started);
    return started;
  };
}

/**
 * App wiring: a short-lived nostr-tools `SimplePool`, over the relays we
 * already keep open for payments.
 */
export const resolveNutzapProfile = createNutzapProfileResolver({
  openPool: () => new SimplePool(),
  discoveryRelays: PAYMENT_RELAYS,
});

/**
 * Start the `kind:10019` lookup as soon as a recipient is known, so the amount
 * screen's lock option is already decided when it renders. Fire-and-forget: the
 * answer lands in the cache, and the screen's own resolve either finds it or
 * joins the in-flight request. Never throws.
 */
export function prefetchNutzapProfile(pubkeyHex: string | undefined | null): void {
  if (!pubkeyHex) return;
  void resolveNutzapProfile(pubkeyHex).catch(() => {
    /* resolveNutzapProfile degrades rather than rejects; this is belt-and-braces */
  });
}
