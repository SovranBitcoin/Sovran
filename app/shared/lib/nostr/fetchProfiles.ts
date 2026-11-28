import type { facade } from 'nostr';

import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { NOSTR_METADATA_STALE_TTL_MS } from '@/shared/stores/global/nostrMetadataCache';

type ProfileMetadata = facade.ProfileMetadata;

/**
 * Fetch kind-0 metadata for a set of pubkeys through the tier-selecting facade
 * (every enabled tier is asked at once and the newest event wins). Always asks
 * the tiers, never answers from the cache alone.
 *
 * Batched in the facade: every pubkey asked for within one frame, by any
 * caller, goes out as ONE request per source, and a pubkey already being
 * fetched joins that request. Returns pubkey → metadata for the ones a tier
 * resolved; never throws. Empty when every tier is disabled or exhausted.
 */
export async function fetchProfilesViaFacade(
  pubkeys: readonly string[]
): Promise<Record<string, ProfileMetadata>> {
  if (pubkeys.length === 0) return {};
  const layer = buildNostrDataLayer();
  if (!layer) return {};
  return layer.loadProfiles(pubkeys);
}

/**
 * Make sure these profiles are loaded, without waiting for them: schedules a
 * batched fetch for each one that is missing or older than the staleness
 * window, unless a recent fetch already found nothing or one is in flight.
 * The row reads the result from the entity cache. Safe to call from every row
 * on every mount: a call that has nothing to do costs a few map lookups.
 */
export function ensureProfilesViaFacade(pubkeys: readonly string[]): void {
  if (pubkeys.length === 0) return;
  buildNostrDataLayer()?.ensureProfiles(pubkeys, { maxAgeMs: NOSTR_METADATA_STALE_TTL_MS });
}

/**
 * Fetch one profile's header (kind-0 metadata + follow/follower/note counts +
 * joined date) through the tier-selecting facade. Primal serves it via
 * `user_profile`; the relay floor derives metadata + following-count. Returns
 * null when every tier is disabled/exhausted. The result also carries the
 * reputation `score` and `rank` when a tier measured them.
 */
export async function fetchProfileStatsViaFacade(
  pubkey: string,
  options: {
    viewerPubkey?: string;
    signal?: AbortSignal;
    readId?: string;
    /** Skip the cache-first answer and ask the tiers (a cached header may lack a count). */
    refresh?: boolean;
  } = {}
): Promise<facade.ResolvedProfileStats | null> {
  const layer = buildNostrDataLayer();
  if (!layer) return null;
  const result = await layer.getProfileStats({
    pubkey,
    ...(options.refresh ? { refresh: true } : {}),
    ...(options.viewerPubkey ? { viewerPubkey: options.viewerPubkey } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.readId ? { readId: options.readId } : {}),
  });
  return result.match(
    (resolved) => resolved,
    () => null
  );
}

/**
 * Following count from the profile's own kind-3 through whichever tier serves
 * social graphs (relays included). Last resort for the profile header when
 * neither nagg nor Primal has counts: a contact list is a plain replaceable
 * event, so the relay floor can answer it. Returns undefined when no kind-3
 * was found (an unknown list must not read as "follows nobody").
 */
export async function fetchFollowingCountViaFacade(
  pubkey: string,
  options: { signal?: AbortSignal; readId?: string } = {}
): Promise<number | undefined> {
  const layer = buildNostrDataLayer();
  if (!layer) return undefined;
  const result = await layer.getSocialGraph({
    pubkey,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.readId ? { readId: options.readId } : {}),
  });
  return result.match(
    (graph) => (graph.contactsUpdatedAt > 0 ? graph.follows.length : undefined),
    () => undefined
  );
}

/** The cached profile header (counts + joined date) for a pubkey, if any tier ever supplied one. */
export function readCachedProfileStats(pubkey: string): facade.CachedProfileStats | undefined {
  return buildNostrDataLayer()?.cache.getProfileStats(pubkey);
}

/**
 * Write a header the app obtained OUTSIDE the facade (nagg's REST profile
 * endpoint) into the single owner, so the next open of this profile seeds its
 * counts synchronously. Only defined counts are written: an unknown count is
 * never recorded as anything.
 */
export function cacheProfileStats(
  pubkey: string,
  stats: {
    followers?: number | null;
    follows?: number | null;
    joinedAtSec?: number | null;
    /** Vertex reputation 0–100; `null` is "not measured" and writes nothing. */
    score?: number | null;
    rank?: number | null;
    vertexFetchedAt?: number | null;
    operatesMints?: readonly string[];
    operatesAiProviders?: readonly string[];
  }
): void {
  const cache = buildNostrDataLayer()?.cache;
  if (!cache) return;
  // The store's merge is field-level and undefined-preserving, so a figure this
  // source lacks leaves the one another source wrote. `null` means the source
  // looked and could not measure — also not a reason to forget a number.
  const num = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  cache.ingestProfileStats({
    pubkey,
    followersCount: num(stats.followers),
    followingCount: num(stats.follows),
    joinedAtSec: num(stats.joinedAtSec),
    score: num(stats.score),
    rank: num(stats.rank),
    vertexFetchedAt: num(stats.vertexFetchedAt),
    operatesMints: stats.operatesMints,
    operatesAiProviders: stats.operatesAiProviders,
  });
}

/**
 * The operator figures a nagg discovery row or AI-provider row carries, written
 * to the single owner so a mint row, a provider row, a search hit and the
 * profile page all show one number for one person. Rows without an operator
 * are skipped; a row with an operator but no figures still records the link
 * from the person to what they run.
 */
export function cacheOperatorStats(
  rows: readonly {
    pubkey?: string;
    followers?: number | null;
    follows?: number | null;
    score?: number | null;
    rank?: number | null;
    operatesMint?: string;
    operatesAiProvider?: string;
  }[]
): void {
  const cache = buildNostrDataLayer()?.cache;
  if (!cache) return;
  for (const row of rows) {
    if (!row.pubkey) continue;
    const existing = cache.getProfileStats(row.pubkey);
    const union = (prev: readonly string[] | undefined, next: string | undefined) =>
      next && !(prev ?? []).includes(next) ? [...(prev ?? []), next] : undefined;
    cacheProfileStats(row.pubkey, {
      followers: row.followers,
      follows: row.follows,
      score: row.score,
      rank: row.rank,
      operatesMints: union(existing?.operatesMints, row.operatesMint),
      operatesAiProviders: union(existing?.operatesAiProviders, row.operatesAiProvider),
    });
  }
}
