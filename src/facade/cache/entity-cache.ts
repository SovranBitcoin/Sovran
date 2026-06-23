import type { NostrTier, NoteStats, NoteStatsMap } from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import type { ProfileMetadata } from '../profiles';
import {
  createNormalizingStore,
  fieldLevelMerge,
  type Merge,
  type NormalizingStore,
} from './store';

// ---------------------------------------------------------------------------
// Source ranking — when the SAME datum arrives from more than one transport,
// the higher-ranked source wins a field conflict (nagg > primal > relay). This
// applies to PROFILE fields and METRICS only; note/reply EXISTENCE is never
// tier-gated (see mergeNote), so a brand-new relay event a higher tier hasn't
// indexed yet is always kept. `'cache'` is rank 0 — a cache-served read never
// outranks a real network source.
// ---------------------------------------------------------------------------

/** Which transport a cached datum came from. */
export type CacheSource = NostrTier;

const TIER_RANK: Record<string, number> = { nagg: 3, primal: 2, relay: 1, cache: 0 };

/** Rank of a source; an unknown/absent source ranks lowest (0). */
export function sourceRank(source: CacheSource | undefined): number {
  return source ? TIER_RANK[source] ?? 0 : 0;
}

// ---------------------------------------------------------------------------
// NostrEntityCache — the facade's shared, additive, in-memory entity store
//
// Every tier writes the entities it resolves (profiles, notes, aggregate stats)
// into this one cache at ingest; every surface reads from it FIRST. So a profile
// loaded for the feed instantly renders a profile page; a note already in the
// feed opens as a thread root with no refetch; stats stop snapping mid-session.
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
 * `seenAt: 0`; a full kind-0 fetch carries the rest at its event `created_at`.
 * `seenAt` gates the merge so a stale/low-confidence write never overwrites a
 * fresher field — it only fills gaps.
 */
export type CachedProfile = ProfileMetadata & {
  pubkey: string;
  /** kind-0 `created_at`, or 0 for a low-confidence (feed/notification) seed. */
  seenAt: number;
  /** Source rank of the dominant fields (nagg>primal>relay); breaks freshness ties. */
  srcRank: number;
};

/** A note/event body, immutable once known (keyed by event id). */
export type CachedNote = NaggFeedEvent;

/**
 * Aggregate note metrics tagged with the rank of their source, so a lower tier
 * (e.g. relay) can never erase counts a higher tier (nagg) already provided.
 * Mirrors how `CachedProfile` extends `ProfileMetadata` with provenance.
 */
export type CachedNoteStats = NoteStats & { srcRank: number };

/** A profile-header aggregate (counts + joined date), keyed by pubkey. */
export type CachedProfileStats = {
  pubkey: string;
  metadata?: ProfileMetadata;
  followersCount?: number;
  followingCount?: number;
  noteCount?: number;
  joinedAt?: number;
};

const DEFAULT_LIMITS = {
  profiles: 5000,
  notes: 5000,
  noteStats: 5000,
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
  };
  for (const key in patch) {
    if (key === 'seenAt' || key === 'srcRank') continue;
    const value = patch[key as keyof CachedProfile];
    if (value === undefined) continue;
    if (incomingWins || base[key as keyof CachedProfile] === undefined) {
      base[key as keyof CachedProfile] = value as never;
    }
  }
  return base;
};

/**
 * Notes are immutable: keep what we have, only fill genuinely-absent fields.
 * INVARIANT: note existence is NEVER tier-gated. A note id is a content hash, so
 * the same id from any source is the same body; a NEW id (e.g. a just-posted
 * relay reply nagg hasn't indexed) is simply inserted, never dropped by ranking.
 */
const mergeNote: Merge<CachedNote> = (existing, patch) => {
  if (!existing) return fieldLevelMerge(undefined, patch);
  const base: CachedNote = { ...existing };
  for (const key in patch) {
    const value = patch[key as keyof CachedNote];
    if (value !== undefined && base[key as keyof CachedNote] === undefined) {
      base[key as keyof CachedNote] = value as never;
    }
  }
  return base;
};

/**
 * Stats merge by source rank: a lower-ranked source never erases a higher one's
 * counts. Higher-or-equal rank overlays field-level (last-write at equal rank);
 * a strictly lower rank is ignored. Note this gates only METRICS, never a note's
 * presence — stats live in a separate store from note bodies.
 */
const mergeNoteStats: Merge<CachedNoteStats> = (existing, patch) => {
  if (!existing) return fieldLevelMerge(undefined, patch);
  const incomingRank = patch.srcRank ?? 0;
  if (incomingRank < existing.srcRank) return existing;
  const merged = fieldLevelMerge(existing, patch);
  merged.srcRank = Math.max(existing.srcRank, incomingRank);
  return merged;
};

export interface NostrEntityCache {
  /** Stores exposed for granular subscription by a binding. Prefer the helpers below for writes. */
  readonly profiles: NormalizingStore<CachedProfile>;
  readonly notes: NormalizingStore<CachedNote>;
  readonly noteStats: NormalizingStore<CachedNoteStats>;
  readonly profileStats: NormalizingStore<CachedProfileStats>;

  /** Seed minimal name+picture (feed/notification profiles) at low confidence, tagged by source. */
  ingestProfileInfos(infos: Record<string, NaggProfileInfo>, source: CacheSource): void;
  /** Ingest full kind-0 metadata at a given freshness (the event `created_at`), tagged by source. */
  ingestProfileMetadata(
    metadata: Record<string, ProfileMetadata>,
    seenAt: number,
    source: CacheSource,
  ): void;
  ingestNotes(events: readonly NaggFeedEvent[]): void;
  ingestNoteStats(stats: NoteStatsMap, source: CacheSource): void;
  ingestProfileStats(stats: CachedProfileStats): void;

  getProfile(pubkey: string): CachedProfile | undefined;
  /** Split requested pubkeys into the ones we already hold vs the ones to fetch. */
  readProfiles(pubkeys: readonly string[]): {
    profiles: Record<string, CachedProfile>;
    missing: string[];
  };
  getNote(id: string): CachedNote | undefined;
  getNoteStats(id: string): NoteStats | undefined;
  getProfileStats(pubkey: string): CachedProfileStats | undefined;

  /** Drop everything — call on profile switch to prevent cross-profile bleed. */
  clear(): void;
}

export function createNostrEntityCache(limits: EntityCacheLimits = {}): NostrEntityCache {
  const profiles = createNormalizingStore<CachedProfile>({
    maxEntries: limits.profiles ?? DEFAULT_LIMITS.profiles,
    merge: mergeProfile,
  });
  const notes = createNormalizingStore<CachedNote>({
    maxEntries: limits.notes ?? DEFAULT_LIMITS.notes,
    merge: mergeNote,
  });
  const noteStats = createNormalizingStore<CachedNoteStats>({
    maxEntries: limits.noteStats ?? DEFAULT_LIMITS.noteStats,
    merge: mergeNoteStats,
  });
  const profileStats = createNormalizingStore<CachedProfileStats>({
    maxEntries: limits.profileStats ?? DEFAULT_LIMITS.profileStats,
  });

  return {
    profiles,
    notes,
    noteStats,
    profileStats,

    ingestProfileInfos(infos, source) {
      const srcRank = sourceRank(source);
      profiles.setMany(
        Object.entries(infos).map(([pubkey, info]) => [
          pubkey,
          { pubkey, name: info.name, picture: info.picture, seenAt: 0, srcRank },
        ]),
      );
    },
    ingestProfileMetadata(metadata, seenAt, source) {
      const srcRank = sourceRank(source);
      profiles.setMany(
        Object.entries(metadata).map(([pubkey, m]) => [pubkey, { ...m, pubkey, seenAt, srcRank }]),
      );
    },
    ingestNotes(events) {
      notes.setMany(events.map((event) => [event.id, event]));
    },
    ingestNoteStats(stats, source) {
      const srcRank = sourceRank(source);
      noteStats.setMany(
        Object.entries(stats).map(([id, stat]) => [id, { ...stat, srcRank }]),
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
    getNote(id) {
      return notes.get(id);
    },
    getNoteStats(id) {
      return noteStats.get(id);
    },
    getProfileStats(pubkey) {
      return profileStats.get(pubkey);
    },

    clear() {
      profiles.clear();
      notes.clear();
      noteStats.clear();
      profileStats.clear();
    },
  };
}
