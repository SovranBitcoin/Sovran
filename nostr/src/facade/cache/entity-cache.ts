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
 * A profile accumulated across sources. A cheap feed seed carries name+picture at
 * `seenAt: 0`; a full kind-0 fetch carries the rest at a higher merge order.
 * `seenAt` gates the merge so a stale/low-confidence write never overwrites a
 * fresher field — it only fills gaps.
 */
export type CachedProfile = ProfileMetadata & {
  pubkey: string;
  /** Merge order: 0 for a seed, 1 for a direct answer, or the caller's event order. */
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

const DEFAULT_LIMITS = {
  profiles: 5000,
  profileStats: 2000,
} as const;

export type EntityCacheLimits = Partial<typeof DEFAULT_LIMITS>;

/**
 * Profile merge with a monotonic guard plus source ranking. A fresher write
 * (`seenAt`) always wins its fields — a genuinely newer kind-0 is the truth,
 * even from a lower-ranked source. At EQUAL freshness, the higher-ranked source
 * wins (nagg>primal>relay). An older write only fills currently-absent fields.
 * Stored `seenAt` advances to the freshest; `srcRank` tracks the winner.
 */
const mergeProfile: Merge<CachedProfile> = (existing, patch) => {
  if (!existing) return fieldLevelMerge(undefined, patch);
  const incomingAt = patch.seenAt ?? 0;
  const incomingRank = patch.srcRank ?? 0;
  const incomingWins =
    incomingAt > existing.seenAt ||
    (incomingAt === existing.seenAt && incomingRank >= existing.srcRank);
  const base: CachedProfile = {
    ...existing,
    seenAt: Math.max(existing.seenAt, incomingAt),
    srcRank: incomingWins ? incomingRank : existing.srcRank,
    fetchedAt:
      Math.max(existing.fetchedAt ?? 0, patch.fetchedAt ?? 0) || undefined,
  };
  for (const key in patch) {
    if (key === "seenAt" || key === "srcRank" || key === "fetchedAt") continue;
    const value = patch[key as keyof CachedProfile];
    if (value === undefined) continue;
    if (incomingWins || base[key as keyof CachedProfile] === undefined) {
      base[key as keyof CachedProfile] = value as never;
    }
  }
  // A fresher full kind-0 event (seenAt > 0) is authoritative for payment
  // endpoints: if it removed lud16 or lud06, clear the stale value so Send
  // never pays an address the user removed. Minimal profile seeds (seenAt 0)
  // never clear existing addresses.
  if (incomingWins && incomingAt > 0) {
    if (patch.lud16 === undefined) delete base.lud16;
    if (patch.lud06 === undefined) delete base.lud06;
  }
  return base;
};

export interface NostrEntityCache {
  /** Stores exposed for granular subscription by a binding. Prefer the helpers below for writes. */
  readonly profiles: NormalizingStore<CachedProfile>;
  readonly profileStats: NormalizingStore<CachedProfileStats>;
  /** Which profile pubkeys have a fetch in flight (loading vs absent, for bindings). */
  readonly pendingProfiles: PendingSet;
  /** First metadata fetch settlement, including misses (memory-only). */
  readonly settledProfiles: NormalizingStore<{ settledAt: number }>;

  /** Seed minimal name+picture (feed/notification profiles) at low confidence, tagged by source. */
  ingestProfileInfos(
    infos: Record<string, NaggProfileInfo>,
    source: CacheSource,
  ): void;
  /** Ingest full kind-0 metadata at a given merge order, tagged by source. */
  ingestProfileMetadata(
    metadata: Record<string, ProfileMetadata>,
    seenAt: number,
    source: CacheSource,
  ): void;
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
    ingestProfileMetadata(metadata, seenAt, source) {
      const srcRank = sourceRank(source);
      const fetchedAt = seenAt > 0 ? Date.now() : undefined;
      profiles.setMany(
        Object.entries(metadata).map(([pubkey, m]) => [
          pubkey,
          {
            ...m,
            pubkey,
            seenAt,
            srcRank,
            ...(fetchedAt !== undefined ? { fetchedAt } : {}),
          },
        ]),
      );
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
      profileStats.clear();
    },
  };
}
