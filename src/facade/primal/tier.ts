import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import type { FeedBundle, FeedPageRequest, FeedSpec } from '../feed';
import type { ThreadBundle, ThreadRequest } from '../thread';
import type { OwnHistoryBundle, OwnHistoryRequest } from '../own-state';
import type { NostrTierStrategy } from '../strategy';
import { demuxPrimalFeed, demuxPrimalThread, demuxPrimalOwnHistory } from './demux';
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

export function createPrimalTier(config: PrimalTierConfig): NostrTierStrategy {
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

    async thread(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>> {
      const cacheRequest: PrimalCacheRequest = {
        verb: 'thread_view',
        params: {
          event_id: request.noteId,
          limit: request.limit ?? 100,
          ...(request.viewerPubkey ? { user_pubkey: request.viewerPubkey } : {}),
        },
      };
      const result = await config.connection.request(cacheRequest, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ThreadBundle>>(
        (events) => {
          const bundle = demuxPrimalThread(events, request.noteId);
          // No root in the batch → Primal couldn't serve this thread; fall through.
          return bundle ? answered(bundle) : unsupported();
        },
        (error) => failed(error),
      );
    },

    async ownHistory(request: OwnHistoryRequest): Promise<TierOutcome<OwnHistoryBundle>> {
      const cacheRequest = ownHistoryCacheRequest(request);
      // Primal has no my-likes / my-reposts list verb → fall straight through to the floor.
      if (!cacheRequest) return unsupported();

      const result = await config.connection.request(cacheRequest, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<OwnHistoryBundle>>(
        (events) => answered(demuxPrimalOwnHistory(events, request.actionType)),
        (error) => failed(error),
      );
    },
  };
}

function ownHistoryCacheRequest(request: OwnHistoryRequest): PrimalCacheRequest | null {
  const pubkey = request.viewerPubkey;
  const limit = request.limit ?? 100;
  const until = request.cursor?.createdAt;
  const paged = (extra: Record<string, unknown>) => ({ ...extra, limit, ...(until ? { until } : {}) });
  switch (request.actionType) {
    case 'authored':
      return { verb: 'feed', params: paged({ notes: 'authored', pubkey }) };
    case 'replies':
      return { verb: 'feed', params: paged({ notes: 'replies', pubkey }) };
    case 'bookmarks':
      return { verb: 'feed', params: paged({ notes: 'bookmarks', pubkey }) };
    case 'zaps-sent':
      return { verb: 'user_zaps_sent', params: paged({ sender: pubkey }) };
    case 'follows':
      return { verb: 'contact_list', params: { pubkey } };
    case 'mutes':
      return { verb: 'mutelist', params: { pubkey } };
    case 'relays':
      return { verb: 'get_user_relays', params: { pubkey } };
    case 'likes':
    case 'reposts':
      return null;
  }
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
