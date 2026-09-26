import type { NaggFeedEvent } from '../../map/feed';
import type { FeedItem, ResolvedFeedPage } from '../feed';
import type { ResolvedThread } from '../thread';
import type { ResolvedNotifications } from '../notifications';
import type { ResolvedSocialGraph } from '../social-graph';
import type { ResolvedProfiles } from '../profiles';
import type { ResolvedProfileStats } from '../profile-stats';
import type { ProfileSearchHit } from '../search';
import type { NaggIdentity } from '../../envelope';
import type { ProfileMetadata } from '../profiles';
import type { CacheSource } from './entity-cache';
import type { NostrEntityCache } from './entity-cache';

// ---------------------------------------------------------------------------
// Write-through ingest — populate the shared entity cache from a resolved read.
//
// Every surface read flows its entities through here so a later, different read
// can serve them instantly. The extraction is the only place that knows a
// surface's shape; the cache itself stays surface-agnostic.
// ---------------------------------------------------------------------------

/**
 * Full kind-0 metadata fetched directly (profiles/profile-stats surfaces) beats
 * a feed/notification seed (`seenAt: 0`) but stays below any real kind-0
 * `created_at` (unix seconds), so a genuinely newer profile event still wins.
 */
const DIRECT_METADATA_SEEN_AT = 1;

/** Every event a feed/thread item carries (note bodies, roots, reposts, previews). */
export function eventsFromFeedItem(item: FeedItem): NaggFeedEvent[] {
  const out: NaggFeedEvent[] = [];
  if (item.type === 'note') {
    out.push(item.event);
    if (item.rootEvent) out.push(item.rootEvent);
    if (item.replyPreviewEvents) out.push(...item.replyPreviewEvents);
  } else {
    out.push(item.repostEvent);
    if (item.originalEvent) out.push(item.originalEvent);
    if (item.rootEvent) out.push(item.rootEvent);
    if (item.reposters) for (const reposter of item.reposters) out.push(reposter.event);
  }
  return out;
}

export function ingestFeedPage(cache: NostrEntityCache, page: ResolvedFeedPage): void {
  const events: NaggFeedEvent[] = [];
  for (const item of page.items) events.push(...eventsFromFeedItem(item));
  events.push(...Object.values(page.quoted));
  cache.ingestNotes(events);
  cache.ingestNoteStats(page.stats, page.tier);
  cache.ingestProfileInfos(page.profiles, page.tier);
}

export function ingestThread(cache: NostrEntityCache, thread: ResolvedThread): void {
  const events: NaggFeedEvent[] = [...eventsFromFeedItem(thread.root)];
  for (const item of thread.parents) events.push(...eventsFromFeedItem(item));
  for (const item of thread.replies) events.push(...eventsFromFeedItem(item));
  // Off-manifest hydration (off-page descendants, quote hydration): cached so
  // tapping one opens instantly, but never rendered in the reply order.
  for (const item of thread.extras) events.push(...eventsFromFeedItem(item));
  events.push(...Object.values(thread.quoted));
  cache.ingestNotes(events);
  cache.ingestNoteStats(thread.stats, thread.tier);
  cache.ingestProfileInfos(thread.profiles, thread.tier);
}

export function ingestNotifications(cache: NostrEntityCache, notifs: ResolvedNotifications): void {
  const events: NaggFeedEvent[] = [];
  for (const item of notifs.notifications) if (item.event) events.push(item.event);
  events.push(...Object.values(notifs.quoted));
  cache.ingestNotes(events);
  cache.ingestNoteStats(notifs.stats, notifs.tier);
  cache.ingestProfileInfos(notifs.profiles, notifs.tier);
}

export function ingestSocialGraph(cache: NostrEntityCache, graph: ResolvedSocialGraph): void {
  cache.ingestProfileInfos(graph.profiles, graph.tier);
}

export function ingestProfiles(cache: NostrEntityCache, resolved: ResolvedProfiles): void {
  cache.ingestProfileMetadata(resolved.profiles, DIRECT_METADATA_SEEN_AT, resolved.tier);
}

export function ingestProfileStats(cache: NostrEntityCache, resolved: ResolvedProfileStats): void {
  if (resolved.metadata) {
    cache.ingestProfileMetadata(
      { [resolved.pubkey]: resolved.metadata },
      DIRECT_METADATA_SEEN_AT,
      resolved.tier,
    );
  }
  cache.ingestProfileStats({
    pubkey: resolved.pubkey,
    metadata: resolved.metadata,
    followersCount: resolved.followersCount,
    followingCount: resolved.followingCount,
    noteCount: resolved.noteCount,
    joinedAtSec: resolved.joinedAtSec,
    score: resolved.score,
    rank: resolved.rank,
    vertexFetchedAt: resolved.vertexFetchedAt,
    operatesMints: resolved.operatesMints,
    operatesAiProviders: resolved.operatesAiProviders,
  });
}

/**
 * Search hits carry the same header figures a profile page shows — rank,
 * score, follower and following counts — plus whatever kind-0 fields nagg had.
 * Write them through so the figures survive the search: before this, a score
 * shown in the results list was gone the moment the row was tapped.
 *
 * A `null` figure is "the tier could not measure it" and is NOT written; the
 * field-level merge then keeps whatever another source already knew.
 */
export function ingestSearchHits(
  cache: NostrEntityCache,
  hits: readonly ProfileSearchHit[],
  source: CacheSource,
): void {
  const metadata: Record<string, ProfileSearchHit['metadata']> = {};
  for (const hit of hits) {
    if (Object.keys(hit.metadata).length > 0) metadata[hit.pubkey] = hit.metadata;
    const stats = {
      pubkey: hit.pubkey,
      followersCount: numberOrUndefined(hit.followers),
      followingCount: numberOrUndefined(hit.follows),
      score: numberOrUndefined(hit.score),
      rank: numberOrUndefined(hit.rank),
      vertexFetchedAt: numberOrUndefined(hit.vertexFetchedAt),
      operatesMints: hit.operatesMints,
      operatesAiProviders: hit.operatesAiProviders,
    };
    if (
      stats.followersCount === undefined &&
      stats.followingCount === undefined &&
      stats.score === undefined &&
      stats.rank === undefined &&
      stats.operatesMints === undefined
    ) {
      continue;
    }
    cache.ingestProfileStats(stats);
  }
  if (Object.keys(metadata).length > 0) {
    // Search metadata is a kind-0 whose `created_at` the hit does not carry:
    // seed it at zero confidence so it fills gaps and never outranks a fetch.
    cache.ingestProfileMetadata(metadata, 0, source);
  }
}

/**
 * nagg's `identities` map, from whichever route carried it (profile, search,
 * discovery, reviews, mint info, the AI provider directory): each entry's
 * figures go to the profile stats and its kind-0 fields seed the profile
 * record at low confidence. One writer for every route, so the six shapes
 * those routes used to spell an operator in collapse into one cache entry.
 */
export function ingestIdentities(
  cache: NostrEntityCache,
  identities: Readonly<Record<string, NaggIdentity>>,
  source: CacheSource,
): void {
  const metadata: Record<string, ProfileMetadata> = {};
  for (const [key, identity] of Object.entries(identities)) {
    const pubkey = identity.pubkey || key;
    cache.ingestProfileStats({
      pubkey,
      followersCount: numberOrUndefined(identity.reach.followers),
      followingCount: numberOrUndefined(identity.reach.follows),
      score: numberOrUndefined(identity.vertex.score),
      rank: numberOrUndefined(identity.vertex.rank),
      vertexFetchedAt: numberOrUndefined(identity.vertex.fetchedAt),
      joinedAtSec: numberOrUndefined(identity.firstEventAt),
      operatesMints: identity.operates.mints,
      operatesAiProviders: identity.operates.aiProviders,
    });
    const profile = identity.profile;
    if (profile && Object.keys(profile).length > 0) {
      metadata[pubkey] = {
        ...(profile.name ? { name: profile.name } : {}),
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        ...(profile.picture ? { picture: profile.picture } : {}),
        ...(profile.banner ? { banner: profile.banner } : {}),
        ...(profile.about ? { about: profile.about } : {}),
        ...(profile.nip05 ? { nip05: profile.nip05 } : {}),
        ...(profile.website ? { website: profile.website } : {}),
        ...(profile.lud16 ? { lud16: profile.lud16 } : {}),
      };
    }
  }
  if (Object.keys(metadata).length > 0) {
    // No kind-0 `created_at` travels with it: zero confidence, fills gaps only.
    cache.ingestProfileMetadata(metadata, 0, source);
  }
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
