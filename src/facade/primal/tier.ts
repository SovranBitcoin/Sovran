import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import type { FeedBundle, FeedPageRequest, FeedSpec, FeedTier } from '../feed';
import { demuxPrimalFeed } from './demux';
import type { PrimalCacheRequest, PrimalConnection } from './protocol';

// ---------------------------------------------------------------------------
// Primal tier (tier 2, "almost as good")
//
// A client adapter to Primal's public cache server. It owns the algo feed
// server-side, so For-You is reachable here when nagg is down. A spec this tier
// can't serve (no Primal equivalent) returns `unsupported` so the facade falls
// straight through to the raw-relay floor.
//
// The mapping from our FeedSpec to Primal's cache directive is the one piece
// that must be pinned against the live Primal cache, so it's an injectable
// resolver with a best-effort default — the protocol, demux, and contract
// mapping around it are exercised independently of any guessed directive string.
// ---------------------------------------------------------------------------

export type PrimalFeedSpecResolver = (
  spec: FeedSpec,
  paging: { until?: number; limit?: number },
) => PrimalCacheRequest | null;

export type PrimalTierConfig = {
  connection: PrimalConnection;
  /** Override the FeedSpec → cache-directive mapping (pinned against live Primal). */
  resolveFeedSpec?: PrimalFeedSpecResolver;
};

export function createPrimalTier(config: PrimalTierConfig): FeedTier {
  const resolveFeedSpec = config.resolveFeedSpec ?? defaultResolveFeedSpec;

  return {
    tier: 'primal',
    async feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>> {
      const cacheRequest = resolveFeedSpec(request.spec, {
        until: request.cursor?.createdAt,
        limit: request.limit,
      });
      if (!cacheRequest) return unsupported();

      const result = await config.connection.request(cacheRequest, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<FeedBundle>>(
        (events) => answered(demuxPrimalFeed(events)),
        (error) => failed(error),
      );
    },
  };
}

function defaultResolveFeedSpec(
  spec: FeedSpec,
  paging: { until?: number; limit?: number },
): PrimalCacheRequest | null {
  switch (spec.kind) {
    case 'for-you':
      return {
        verb: 'mega_feed_directive',
        params: {
          spec: JSON.stringify({ id: 'for-you', kind: 'notes' }),
          limit: paging.limit ?? 30,
          ...(paging.until ? { until: paging.until } : {}),
          ...(spec.viewerPubkey ? { user_pubkey: spec.viewerPubkey } : {}),
        },
      };
    case 'following-popular':
      // No direct Primal equivalent without server-side follow-graph wiring — fall through.
      return null;
  }
}
