import type { NostrTier } from "@sovranbitcoin/schemas";
import type { NaggProfileInfo } from "../../map/feed";
import type { ProfileMetadata } from "../profiles";
import type { ProfileStats } from "../profile-stats";
import {
  createNormalizingStore,
  fieldLevelMerge,
  type Merge,
  type NormalizingStore,
} from "./store";
import { createPendingSet, type PendingSet } from "./pending";

// ---------------------------------------------------------------------------
// Source ranking — when the SAME datum arrives from more than one transport,
// the higher-ranked source wins a field conflict (nagg > primal > relay). This
// applies to PROFILE fields and METRICS. `'cache'` is rank 0 — a cache-served read never
// outranks a real network source.
// ---------------------------------------------------------------------------

/** Which transport a cached datum came from. */
export type CacheSource = NostrTier;

const TIER_RANK: Record<string, number> = {
  nagg: 3,
  primal: 2,
  relay: 1,
  cache: 0,
};

/** Rank of a source; an unknown/absent source ranks lowest (0). */
export function sourceRank(source: CacheSource | undefined): number {
  return source ? (TIER_RANK[source] ?? 0) : 0;
}

// ---------------------------------------------------------------------------
// NostrEntityCache — the facade's shared, additive, in-memory entity store
//
// Every tier writes the entities it resolves (profiles, aggregate stats) into
// this one cache at ingest; every surface reads from it FIRST. So a profile
// loaded for search instantly renders a profile page, and stats stop snapping
// mid-session.
//
// BOUNDARY: this cache holds only NETWORK-FETCHED entities that any viewer would
// see. The viewer's OWN action state (which notes *I* liked/reposted) is NOT
// here — it stays authoritative in the app's nostrSocialStore/ownContentStore
// (ADR-0002) and is overlaid onto these entities at the call site. One owner each.
//
// PROFILE-SCOPED: the cache is per-active-profile. Switching identity must
// `clear()` it so one account never renders another's cached data.
// ---------------------------------------------------------------------------

/**
 * A profile's kind-0, merged across sources. `seenAt` is the merge order: the
 * `created_at` (unix seconds) of the kind-0 event the fields came from, `1`
 * for a direct answer whose event time is unknown, `0` for a seed (a name and
 * picture lifted from a feed row, a search index entry, the persisted mirror
 * of an entry saved before event times were kept).
 */
export type CachedProfile = ProfileMetadata & {
  pubkey: string;
  /** Kind-0 `created_at` in unix seconds; 1 when unknown; 0 for a seed. */
  seenAt: number;
  /** Epoch milliseconds of the latest settled metadata answer; seeds omit it. */
  fetchedAt?: number;
  /** Source rank of the dominant fields (nagg>primal>relay); breaks freshness ties. */
  srcRank: number;
};

/**
 * A profile-header aggregate keyed by pubkey: counts, joined date, Vertex
 * reputation and what the pubkey operates. This is the ONE owner of "how
 * reputable / how followed is this person" — search hits, discovery rows, the
 * AI provider directory and the REST profile all write here, so a figure seen
 * on one surface is the figure every other surface shows.
 */
export type CachedProfileStats = ProfileStats;

/**
 * A profile fetch that found nothing. `missUntil` is when asking again is
 * worth it; until then a row renders its fallback instead of refetching on
 * every mount. Memory only.
 */
export type ProfileMiss = {
  /** Epoch milliseconds before which the profile is not asked for again. */
  missUntil: number;
  /** Consecutive fetches in which every source answered and none had it. */
  misses: number;
};

/** Every source answered and none had the profile: 1 min, then 10 min, then 1 h. */
const MISS_BACKOFF_MS = [60_000, 600_000, 3_600_000] as const;
/** No source answered at all (offline, every tier down): ask again soon, and do not escalate. */
const FAILED_FETCH_RETRY_MS = 30_000;
/**
 * A re-answer that changes nothing moves `fetchedAt` only when it is at least
 * this much newer, so revalidating a profile does not hand every row showing
 * it a new object. Far below the 24 h staleness window the stamp is read for.
 */
const FETCHED_AT_GRANULARITY_MS = 5 * 60_000;

const DEFAULT_LIMITS = {
  profiles: 5000,
  profileStats: 2000,
} as const;

export type EntityCacheLimits = Partial<typeof DEFAULT_LIMITS>;

const PROFILE_BOOKKEEPING = new Set(['pubkey', 'seenAt', 'srcRank', 'fetchedAt']);

function laterFetchedAt(existing: number | undefined, incoming: number | undefined): number | undefined {
  if (incoming === undefined) return existing;
  if (existing === undefined) return incoming;
  return incoming - existing >= FETCHED_AT_GRANULARITY_MS ? incoming : existing;
}

/**
 * Profile merge: a kind-0 is a replaceable event, so the newest `created_at`
 * wins the WHOLE value.
 *
 * - Newer event (`seenAt` above the stored one): replaces every field. A field
 *   the newer event no longer carries is removed, whichever field it is. That
 *   is what stops Send paying a Lightning address the person took down.
 * - Same `seenAt`: the same event from two sources, or two answers whose event
 *   time is unknown. The higher-ranked source wins a field conflict
 *   (nagg>primal>relay) and the other fills what it left blank.
 * - Older event: ignored. It may not fill a blank either: a field missing from
 *   the newer event is a removal, not a gap.
 * - Seed (`seenAt` 0) onto a real event: fills blank display fields only, and
 *   never a payment address (`lud16`, `lud06`): an index's stale copy must not
 *   put back an address the event removed.
 */
const mergeProfile: Merge<CachedProfile> = (existing, patch) => {
  if (!existing) return fieldLevelMerge(undefined, patch);
  const incomingAt = patch.seenAt ?? 0;
  const incomingRank = patch.srcRank ?? 0;
  const fetchedAt = laterFetchedAt(existing.fetchedAt, patch.fetchedAt);

  if (incomingAt > existing.seenAt) {
    const replaced: CachedProfile = { pubkey: existing.pubkey, seenAt: incomingAt, srcRank: incomingRank };
    for (const key in patch) {
      if (PROFILE_BOOKKEEPING.has(key)) continue;
      const value = patch[key as keyof CachedProfile];
      if (value !== undefined) replaced[key as keyof CachedProfile] = value as never;
    }
    if (fetchedAt !== undefined) replaced.fetchedAt = fetchedAt;
    return replaced;
  }

  const base: CachedProfile = { ...existing };
  if (fetchedAt !== undefined) base.fetchedAt = fetchedAt;

  if (incomingAt < existing.seenAt) {
    if (incomingAt > 0) return base;
    for (const key in patch) {
      if (PROFILE_BOOKKEEPING.has(key) || key === 'lud16' || key === 'lud06') continue;
      const value = patch[key as keyof CachedProfile];
      if (value !== undefined && base[key as keyof CachedProfile] === undefined) {
        base[key as keyof CachedProfile] = value as never;
      }
    }
    return base;
  }

  const incomingWins = incomingRank >= existing.srcRank;
  if (incomingWins) base.srcRank = incomingRank;
  for (const key in patch) {
    if (PROFILE_BOOKKEEPING.has(key)) continue;
    const value = patch[key as keyof CachedProfile];
    if (value === undefined) continue;
    if (incomingWins || base[key as keyof CachedProfile] === undefined) {
      base[key as keyof CachedProfile] = value as never;
    }
  }
  // Two real answers at the same order: the winning one is authoritative for
  // payment addresses, so an address it lacks is cleared. Seeds never clear.
  if (incomingWins && incomingAt > 0) {
    if (patch.lud16 === undefined) delete base.lud16;
    if (patch.lud06 === undefined) delete base.lud06;
  }
  return base;
};

/** Per-pubkey overrides for an ingest whose entries do not share one time. */
export type ProfileIngestTimes = {
  /** Kind-0 `created_at` (unix seconds) per pubkey; replaces the call's `seenAt` where present. */
  createdAt?: Readonly<Record<string, number | undefined>>;
  /** When each entry was fetched (epoch ms); defaults to now for a real event, absent for a seed. */
  fetchedAt?: Readonly<Record<string, number | undefined>>;
};

export interface NostrEntityCache {
  /** Stores exposed for granular subscription by a binding. Prefer the helpers below for writes. */
  readonly profiles: NormalizingStore<CachedProfile>;
  readonly profileStats: NormalizingStore<CachedProfileStats>;
  /** Which profile pubkeys have a fetch in flight (loading vs absent, for bindings). */
  readonly pendingProfiles: PendingSet;
  /** First metadata fetch settlement, including misses (memory-only). */
  readonly settledProfiles: NormalizingStore<{ settledAt: number }>;
  /** Profiles a fetch did not find, with when to ask again (memory-only). */
  readonly profileMisses: NormalizingStore<ProfileMiss>;

  /** Seed minimal name+picture (feed/notification profiles) at low confidence, tagged by source. */
  ingestProfileInfos(
    infos: Record<string, NaggProfileInfo>,
    source: CacheSource,
  ): void;
  /**
   * Ingest full kind-0 metadata, tagged by source. `seenAt` is the merge order
   * for every entry (0 = seed, 1 = real but event time unknown); `times`
   * carries each entry's own kind-0 `created_at`, which is what lets the
   * newest event win.
   */
  ingestProfileMetadata(
    metadata: Record<string, ProfileMetadata>,
    seenAt: number,
    source: CacheSource,
    times?: ProfileIngestTimes,
  ): void;
  /**
   * Record how a fetch for these pubkeys ended, once every source has settled.
   * `answered`: at least one source replied; a pubkey still without a real
   * kind-0 is a miss, backed off 1 min → 10 min → 1 h. `failed`: no source
   * replied; ask again in 30 s, without escalating. A pubkey that now has a
   * real kind-0 has its miss cleared either way.
   */
  settleProfileFetch(pubkeys: readonly string[], outcome: 'answered' | 'failed', now?: number): void;
  /** True while a recorded miss says not to ask for this profile again yet. */
  isProfileMissed(pubkey: string, now?: number): boolean;
  ingestProfileStats(stats: CachedProfileStats): void;

  getProfile(pubkey: string): CachedProfile | undefined;
  /** Split requested pubkeys into the ones we already hold vs the ones to fetch. */
  readProfiles(pubkeys: readonly string[]): {
    profiles: Record<string, CachedProfile>;
    missing: string[];
  };
  getProfileStats(pubkey: string): CachedProfileStats | undefined;

  /** Drop everything — call on profile switch to prevent cross-profile bleed. */
  clear(): void;
}

export function createNostrEntityCache(
  limits: EntityCacheLimits = {},
): NostrEntityCache {
  const profiles = createNormalizingStore<CachedProfile>({
    name: 'profiles',
    maxEntries: limits.profiles ?? DEFAULT_LIMITS.profiles,
    merge: mergeProfile,
  });
  const profileStats = createNormalizingStore<CachedProfileStats>({
    name: 'profileStats',
    maxEntries: limits.profileStats ?? DEFAULT_LIMITS.profileStats,
  });

  const settledProfiles = createNormalizingStore<{ settledAt: number }>({
    name: 'settledProfiles',
    maxEntries: limits.profiles ?? DEFAULT_LIMITS.profiles,
  });
  const profileMisses = createNormalizingStore<ProfileMiss>({
    name: 'profileMisses',
    maxEntries: limits.profiles ?? DEFAULT_LIMITS.profiles,
  });
  const pending = createPendingSet();
  const pendingProfiles: PendingSet = {
    ...pending,
    end(keys) {
      for (const key of keys) {
        if (pending.has(key) && !settledProfiles.has(key)) {
          settledProfiles.set(key, { settledAt: Date.now() });
        }
      }
      pending.end(keys);
    },
  };

  return {
    profiles,
    profileStats,
    pendingProfiles,
    settledProfiles,
    profileMisses,

    ingestProfileInfos(infos, source) {
      const srcRank = sourceRank(source);
      profiles.setMany(
        Object.entries(infos).map(([pubkey, info]) => [
          pubkey,
          {
            pubkey,
            name: info.name,
            picture: info.picture,
            seenAt: 0,
            srcRank,
          },
        ]),
      );
    },
    ingestProfileMetadata(metadata, seenAt, source, times) {
      const srcRank = sourceRank(source);
      const now = Date.now();
      profiles.setMany(
        Object.entries(metadata).map(([pubkey, m]) => {
          const createdAt = times?.createdAt?.[pubkey];
          const at = typeof createdAt === 'number' && createdAt > 0 ? createdAt : seenAt;
          const fetchedAt = times?.fetchedAt?.[pubkey] ?? (at > 0 ? now : undefined);
          return [
            pubkey,
            { ...m, pubkey, seenAt: at, srcRank, ...(fetchedAt !== undefined ? { fetchedAt } : {}) },
          ];
        }),
      );
    },
    settleProfileFetch(pubkeys, outcome, now = Date.now()) {
      for (const pubkey of pubkeys) {
        if ((profiles.peek(pubkey)?.seenAt ?? 0) > 0) {
          profileMisses.delete(pubkey);
          continue;
        }
        const misses = profileMisses.peek(pubkey)?.misses ?? 0;
        if (outcome === 'failed') {
          profileMisses.set(pubkey, { missUntil: now + FAILED_FETCH_RETRY_MS, misses });
          continue;
        }
        const step = MISS_BACKOFF_MS[Math.min(misses, MISS_BACKOFF_MS.length - 1)]!;
        profileMisses.set(pubkey, { missUntil: now + step, misses: misses + 1 });
      }
    },
    isProfileMissed(pubkey, now = Date.now()) {
      const miss = profileMisses.peek(pubkey);
      return !!miss && miss.missUntil > now;
    },
    ingestProfileStats(stats) {
      profileStats.set(stats.pubkey, stats);
    },

    getProfile(pubkey) {
      return profiles.get(pubkey);
    },
    readProfiles(pubkeys) {
      const out: Record<string, CachedProfile> = {};
      const missing: string[] = [];
      for (const pubkey of pubkeys) {
        const hit = profiles.get(pubkey);
        if (hit) out[pubkey] = hit;
        else missing.push(pubkey);
      }
      return { profiles: out, missing };
    },
    getProfileStats(pubkey) {
      return profileStats.get(pubkey);
    },

    clear() {
      profiles.clear();
      settledProfiles.clear();
      profileMisses.clear();
      profileStats.clear();
    },
  };
}
