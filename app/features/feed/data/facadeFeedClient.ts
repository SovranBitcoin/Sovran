import { facade } from 'nostr';

import type { FeedEvent, FeedItem } from '@/features/feed/components/nostr/feedTypes';
import { feedLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import {
  isRootNote,
  mapAppSpecToFeedSpec,
  resolvedFeedPageToParseResult,
} from './facadeFeedAdapter';
import { recordDebugTiers } from '../stores/debugTierStore';
import {
  resolvedNotificationsToResult,
  toFacadeNotificationsRequest,
} from './facadeNotificationsAdapter';
import {
  emptyThreadResult,
  resolvedThreadToResult,
  toFacadeThreadRequest,
} from './facadeThreadAdapter';
import {
  emptyFeedParseResult,
  type FeedClient,
  type FeedNotificationsResult,
  type FeedParseResult,
  type ThreadResult,
  type ThreadSeedBuckets,
} from './feedClient';

// ---------------------------------------------------------------------------
// Cache bridge: the nagg GraphQL fast-paths (thread, user feeds, posts-by-pubkey)
// return app-shaped results WITHOUT writing to the shared entity cache the way
// the facade reads do. These helpers write those results back into the singleton
// cache, tagged 'nagg' (the source that served them), so a later read — opening a
// reply as its own thread, revisiting a profile — serves them instantly. The
// for-you/notifications facade paths already ingest; this closes the gap.
// ---------------------------------------------------------------------------

function eventsFromAppFeedItem(item: FeedItem): FeedEvent[] {
  const out: FeedEvent[] = [];
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

/** Write a thread result's notes/profiles/metrics into the shared cache. */
function ingestThreadIntoCache(result: ThreadSeedBuckets): void {
  // Dev-only: this is the nagg GraphQL thread path, so every note here was served
  // by nagg — badge it as such on PostCard. No-op in production.
  if (__DEV__) recordDebugTiers([...result.allEvents.keys()], 'nagg');
  const cache = buildNostrDataLayer()?.cache;
  if (!cache) return;
  cache.ingestNotes([...result.allEvents.values(), ...result.quotedEvents.values()]);
  cache.ingestProfileInfos(Object.fromEntries(result.profiles), 'nagg');
  cache.ingestNoteStats(facade.statsFromMetrics(Object.fromEntries(result.metrics)), 'nagg');
}

/** Write a parsed feed/user-feed page's notes/profiles/metrics into the shared cache. */
function ingestFeedPageIntoCache(result: FeedParseResult): void {
  // Dev-only: the nagg GraphQL feed paths (home fallback, profile feed, search)
  // funnel through here, so badge every rendered note as 'nagg'. No-op in prod.
  if (__DEV__) {
    const ids: string[] = [];
    for (const item of result.orderedFeedItems) {
      for (const event of eventsFromAppFeedItem(item)) ids.push(event.id);
    }
    recordDebugTiers(ids, 'nagg');
  }
  const cache = buildNostrDataLayer()?.cache;
  if (!cache) return;
  const events: FeedEvent[] = [];
  for (const item of result.orderedFeedItems) events.push(...eventsFromAppFeedItem(item));
  events.push(...result.quotedEventsMap.values());
  cache.ingestNotes(events);
  cache.ingestProfileInfos(Object.fromEntries(result.profilesMap), 'nagg');
  cache.ingestNoteStats(facade.statsFromMetrics(Object.fromEntries(result.metricsMap)), 'nagg');
}

// ---------------------------------------------------------------------------
// Facade-backed feed client.
//
// Routes the home feeds (for-you / following-popular), user/profile feeds,
// posts-by-pubkeys, and notifications through the tier-selecting nagg-ts
// facade so the Settings → Network toggles actually change which source
// (nagg → Primal → relays) serves each read — visible in the bridged nostr.*
// logs — and so a down nagg degrades to Primal/relay instead of blanking the
// surface. Threads keep nagg's viewer-ranked GraphQL gold path while nagg is
// enabled (the app-view can't reproduce that ranking); enrichment and
// following-replies still delegate to the legacy client.
//
// The pure shape bridge lives in facadeFeedAdapter.
// ---------------------------------------------------------------------------

// Feed reads must not wait out the transport's 30s default when a tier is
// down — a page that takes 8s is already failed from the user's perspective,
// and the waterfall still has Primal + relays to try.
const FEED_READ_TIMEOUT_MS = 8_000;

export function createFacadeFeedClient(fallback: FeedClient): FeedClient {
  return {
    ...fallback,
    async getFeed(request): Promise<FeedParseResult> {
      const spec = mapAppSpecToFeedSpec(request.spec, request.userPubkey);
      if (!spec) {
        const result = await fallback.getFeed(request);
        ingestFeedPageIntoCache(result);
        return result;
      }

      const layer = buildNostrDataLayer();
      if (!layer) {
        // Every tier disabled — surface the empty feed so the toggle is visible.
        return emptyFeedParseResult();
      }

      const result = await layer.getFeedPage({
        spec,
        limit: request.limit,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? FEED_READ_TIMEOUT_MS,
        cursor: request.until ? { createdAt: request.until, id: '' } : null,
      });

      return result.match(
        (page) => resolvedFeedPageToParseResult(page),
        (error) => {
          feedLog.warn('feed.facade.exhausted', {
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
          return emptyFeedParseResult();
        }
      );
    },

    async getThread(request): Promise<ThreadResult> {
      // nagg's GraphQL thread is the viewer-ranked gold path (authoredReplyChain
      // + rankedReferencedBy); its REST app-view — and thus the facade's nagg
      // tier — can't reproduce that ranking. So keep the GraphQL path whenever
      // nagg is enabled, and only route threads through the facade (Primal →
      // relay) when nagg is toggled off, so the cache/relay tiers can serve them.
      if (getNostrTierConfig().nagg.enabled) {
        const result = await fallback.getThread(request);
        ingestThreadIntoCache(result);
        return result;
      }

      // Never throw: useThread's seeded-error path keeps isLoading=true on a
      // throw (so a transient nagg error doesn't clobber a seeded render), which
      // would leave the thread on skeletons forever. Any failure here resolves
      // to an empty thread so loading always clears.
      try {
        const layer = buildNostrDataLayer();
        if (!layer) return emptyThreadResult(request);

        const result = await layer.getThread(toFacadeThreadRequest(request));
        return result.match(
          (thread) => resolvedThreadToResult(thread, request),
          (error) => {
            feedLog.warn('thread.facade.exhausted', {
              attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
            });
            return emptyThreadResult(request);
          }
        );
      } catch (error) {
        feedLog.warn('thread.facade.threw', {
          error: error instanceof Error ? error.message : String(error),
        });
        return emptyThreadResult(request);
      }
    },

    async getUserFeed(request): Promise<FeedParseResult> {
      // Full facade routing: the legacy nagg-only pass-through meant a down
      // nagg produced an EMPTY profile feed even though Primal and the relays
      // could serve it — the tier engine already speaks the `user` spec on
      // all three tiers. The nagg tier hits the same userFeedAppView route
      // the legacy client used, so a healthy nagg serves identical pages;
      // the legacy author-owned root-note/repost filters are re-applied so
      // replies stay out of profile feeds no matter which tier answers.
      const layer = buildNostrDataLayer();
      if (!layer) return emptyFeedParseResult();

      const result = await layer.getFeedPage({
        spec: { kind: 'user', pubkey: request.pubkey },
        limit: request.limit,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? FEED_READ_TIMEOUT_MS,
        cursor: request.until ? { createdAt: request.until, id: '' } : null,
      });

      return result.match(
        (page) => {
          const parsed = resolvedFeedPageToParseResult(page, {
            includeNote: (event) => event.pubkey === request.pubkey && isRootNote(event),
            includeRepost: (event) => event.pubkey === request.pubkey,
            extraProfile: request.authorName
              ? {
                  pubkey: request.pubkey,
                  profile: { name: request.authorName, picture: request.authorPicture },
                }
              : undefined,
          });
          feedLog.info('feed.user.page.done', {
            tier: page.tier,
            items: parsed.orderedFeedItems.length,
            paged: !!request.until,
            paginationUntil: parsed.paginationUntil,
          });
          return parsed;
        },
        (error) => {
          feedLog.warn('feed.user.facade.exhausted', {
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
          return emptyFeedParseResult();
        }
      );
    },

    async getPostsByPubkeys(request): Promise<FeedParseResult> {
      if (request.pubkeys.length === 0) return emptyFeedParseResult();
      // Multi-author reads map to `following-recent` (chronological over an
      // author set) — NOT the single-`user` spec.
      const layer = buildNostrDataLayer();
      if (!layer) return emptyFeedParseResult();

      const pubkeySet = new Set(request.pubkeys);
      const result = await layer.getFeedPage({
        spec: { kind: 'following-recent', authors: request.pubkeys },
        limit: request.limit,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? FEED_READ_TIMEOUT_MS,
        cursor: request.until ? { createdAt: request.until, id: '' } : null,
      });

      return result.match(
        (page) =>
          resolvedFeedPageToParseResult(page, {
            includeNote: (event) => pubkeySet.has(event.pubkey) && isRootNote(event),
            includeRepost: (event) => pubkeySet.has(event.pubkey),
          }),
        (error) => {
          feedLog.warn('feed.posts_by_pubkeys.facade.exhausted', {
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
          return emptyFeedParseResult();
        }
      );
    },

    async getNotifications(request): Promise<FeedNotificationsResult> {
      const facadeRequest = toFacadeNotificationsRequest(request);
      if (!facadeRequest) return fallback.getNotifications(request);

      const layer = buildNostrDataLayer();
      if (!layer) return emptyNotificationsResult();

      const result = await layer.getNotifications(facadeRequest);
      return result.match(
        (page) => resolvedNotificationsToResult(page),
        (error) => {
          feedLog.warn('notifications.facade.exhausted', {
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
          return emptyNotificationsResult();
        }
      );
    },
  };
}

function emptyNotificationsResult(): FeedNotificationsResult {
  return {
    notifications: [],
    profilesMap: new Map(),
    metricsMap: new Map(),
    quotedEventsMap: new Map(),
    paginationUntil: 0,
    hasNextPage: false,
  };
}
