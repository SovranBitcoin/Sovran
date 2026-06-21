import { feedLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import { mapAppSpecToFeedSpec, resolvedFeedPageToParseResult } from './facadeFeedAdapter';
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
// Facade-backed feed client (local-dev tier validation).
//
// Routes the for-you / following-popular home feeds through the tier-selecting
// nagg-ts facade so the Settings → Network toggles actually change which source
// (nagg → Primal → relays) serves the feed — visible in the bridged nostr.* logs.
// Every other read (threads, user feeds, following-replies, enrichment,
// notifications) delegates to the existing client unchanged.
//
// The pure shape bridge lives in facadeFeedAdapter; see buildNostrDataLayer for
// the published-nagg-ts caveat (local-dev only).
// ---------------------------------------------------------------------------

export function createFacadeFeedClient(fallback: FeedClient): FeedClient {
  return {
    ...fallback,
    async getFeed(request): Promise<FeedParseResult> {
      const spec = mapAppSpecToFeedSpec(request.spec, request.userPubkey);
      if (!spec) return fallback.getFeed(request);

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
      if (getNostrTierConfig().nagg.enabled) return fallback.getThread(request);

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
