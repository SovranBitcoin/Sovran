import { feedLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { mapAppSpecToFeedSpec, resolvedFeedPageToParseResult } from './facadeFeedAdapter';
import { emptyFeedParseResult, type FeedClient, type FeedParseResult } from './feedClient';

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
  };
}
