import { facade } from 'nostr';

import type { FeedEvent, FeedItem } from '@/features/feed/components/nostr/feedTypes';
import { feedLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import {
  isRootNote,
  mapAppSpecToFeedSpec,
  MAX_FEED_POST_CHARS,
  resolvedFeedPageToParseResult,
  skimmableFeedFilters,
} from './facadeFeedAdapter';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { emptyNotificationsResult } from '@/features/feed/lib/notificationResults';
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
// hung — but nagg is the QUALITY tier, and its ranked feed can legitimately
// take several seconds cold (field logs showed real answers just past 8s, so
// an 8s cap silently traded every feed to Primal/relay). 15s cuts a genuine
// hang in half while letting a slow-but-alive nagg still serve the gold page;
// the waterfall still has Primal + relays after it.
const FEED_READ_TIMEOUT_MS = 15_000;

/**
 * The transport half of a feed-page read — everything except which feed it is.
 * Every `getFeedPage` caller below spreads this, so the timeout default and the
 * cursor encoding are decided once instead of per spec.
 *
 * `until` is falsy-checked deliberately: `0` is this codebase's "no more pages"
 * sentinel (`paginationUntil > 0` is how every caller tests for another page),
 * so a zero cursor means no cursor, not "everything before the epoch".
 */
function feedPageTransport(request: {
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  until?: number;
}) {
  return {
    limit: request.limit,
    refresh: request.refresh,
    signal: request.signal,
    timeoutMs: request.timeoutMs ?? FEED_READ_TIMEOUT_MS,
    cursor: request.until ? { createdAt: request.until, id: '' } : null,
  };
}

export function createFacadeFeedClient(fallback: Omit<FeedClient, 'getThread'>): FeedClient {
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
        ...feedPageTransport(request),
        // Rank-paged specs advance by absolute offset (rank order is not
        // chronological); the nagg tier consumes it, time-paged tiers ignore it.
        ...(request.offset ? { offset: request.offset } : {}),
        // Skimmable home feed: nagg drops over-long text notes server-side so
        // the page stays full; skimmableFeedFilters below is the parity net
        // for Primal/relay pages (and reposts of long originals).
        maxContentLength: MAX_FEED_POST_CHARS,
      });

      return result.match(
        (page) => resolvedFeedPageToParseResult(page, skimmableFeedFilters),
        (error) => {
          feedLog.warn('feed.facade.exhausted', {
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
          return emptyFeedParseResult();
        }
      );
    },

    async getThread(request): Promise<ThreadResult> {
      // One path for every tier: the facade waterfall (nagg → Primal → relay).
      // The facade's nagg tier sends the full ranked-thread parameter set, so
      // the old nagg-only bypass (and its "REST can't reproduce the ranking"
      // rationale) is gone — a failing nagg now falls through instead of
      // throwing, and ingestion happens inside the data layer.

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
        ...feedPageTransport(request),
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
        ...feedPageTransport(request),
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

    openNotificationsSession(request) {
      const facadeRequest = toFacadeNotificationsRequest(request);
      if (!facadeRequest) return null;
      const layer = buildNostrDataLayer();
      if (!layer) {
        feedLog.warn('feed.notifications.facade.no_layer', {
          tab: request.tab ?? 'ALL',
          policy: request.policy,
          replyScope: request.replyScope,
        });
        return null;
      }
      const session = layer.openNotificationsSession(facadeRequest);
      const map = (page: facade.ResolvedNotifications): FeedNotificationsResult => {
        const mapped = resolvedNotificationsToResult(page);
        return { ...mapped, hasNextPage: session.hasMore() };
      };
      return {
        firstPage: async () => {
          const page = await session.firstPage();
          feedLog.info('feed.notifications.fetch.done', {
            transport: 'session',
            tier: page.tier,
            tab: request.tab ?? 'ALL',
            policy: request.policy,
            replyScope: request.replyScope,
            results: page.notifications.length,
            pending: session.pendingCount(),
            hasNextPage: session.hasMore(),
          });
          return map(page);
        },
        loadMore: async () => map(await session.loadMore()),
        snapshot: () => map(session.snapshot()),
        hasMore: () => session.hasMore(),
        pendingCount: () => session.pendingCount(),
        subscribe: (listener) => session.subscribe(listener),
        close: () => session.close(),
      };
    },

    async getNotifications(request): Promise<FeedNotificationsResult> {
      const facadeRequest = toFacadeNotificationsRequest(request);
      if (!facadeRequest) return fallback.getNotifications(request);

      const layer = buildNostrDataLayer();
      if (!layer) {
        feedLog.warn('feed.notifications.facade.no_layer', {
          tab: request.tab ?? 'ALL',
          policy: request.policy,
          replyScope: request.replyScope,
        });
        return emptyNotificationsResult();
      }

      const result = await layer.getNotifications(facadeRequest);
      return result.match(
        (page) => {
          const mapped = resolvedNotificationsToResult(page);
          // Mirrors the nagg client's fetch.done, plus the tier that actually
          // answered — the waterfall means the same filters can be served by
          // different tiers with different result shapes.
          feedLog.info('feed.notifications.fetch.done', {
            transport: 'facade',
            tier: page.tier,
            tab: request.tab ?? 'ALL',
            policy: request.policy,
            replyScope: request.replyScope,
            until: request.until ?? 0,
            refresh: !!request.refresh,
            results: mapped.notifications.length,
            metrics: mapped.metricsMap.size,
            profiles: mapped.profilesMap.size,
            paginationUntil: mapped.paginationUntil,
            hasNextPage: mapped.hasNextPage,
          });
          return mapped;
        },
        (error) => {
          feedLog.warn('notifications.facade.exhausted', {
            tab: request.tab ?? 'ALL',
            policy: request.policy,
            replyScope: request.replyScope,
            attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
          });
          return emptyNotificationsResult();
        }
      );
    },
  };
}
