import type { NaggFeedEvent } from '../../map/feed';
import type { FeedItem, ResolvedFeedPage } from '../feed';
import type { ResolvedThread } from '../thread';
import type { ResolvedNotifications } from '../notifications';
import type { ResolvedSocialGraph } from '../social-graph';
import type { ResolvedProfiles } from '../profiles';
import type { ResolvedProfileStats } from '../profile-stats';
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
  for (const item of thread.replies) events.push(...eventsFromFeedItem(item));
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
    joinedAt: resolved.joinedAt,
  });
}
