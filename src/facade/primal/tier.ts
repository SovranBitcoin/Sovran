import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import type { FeedBundle, FeedPageRequest, FeedSpec } from '../feed';
import type { ThreadBundle, ThreadRequest } from '../thread';
import type { OwnHistoryBundle, OwnHistoryRequest } from '../own-state';
import { profilesFromKind0, type ProfilesBundle, type ProfilesRequest } from '../profiles';
import {
  profileStatsIsEmpty,
  type ProfileStatsBundle,
  type ProfileStatsRequest,
} from '../profile-stats';
import type { SocialGraph, SocialGraphRequest } from '../social-graph';
import {
  profileSearchHitsFromKind0,
  type ProfileSearchBundle,
  type SearchRequest,
} from '../search';
import type { NostrTierStrategy } from '../strategy';
import {
  demuxPrimalFeed,
  demuxPrimalThread,
  demuxPrimalOwnHistory,
  demuxPrimalProfileStats,
  demuxPrimalSocialGraph,
} from './demux';
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
        (events) => {
          const bundle = demuxPrimalFeed(events);
          // Empty page → fall through (e.g. Primal lacks this viewer's data).
          return bundle.itemsById.size === 0 ? unsupported() : answered(bundle);
        },
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

    async getProfileStats(request: ProfileStatsRequest): Promise<TierOutcome<ProfileStatsBundle>> {
      // `user_profile` bundles the real kind-0 + the synthetic USER_PROFILE stats
      // (counts + time_joined) for one pubkey. No reputation — that's nagg-only.
      const result = await config.connection.request(
        {
          verb: 'user_profile',
          params: {
            pubkey: request.pubkey,
            ...(request.viewerPubkey ? { user_pubkey: request.viewerPubkey } : {}),
          },
        },
        { signal: request.signal, timeoutMs: request.timeoutMs },
      );
      return result.match<TierOutcome<ProfileStatsBundle>>(
        (events) => {
          const bundle = demuxPrimalProfileStats(events, request.pubkey);
          // Nothing useful (Primal doesn't hold this profile) → fall to the floor.
          return profileStatsIsEmpty(bundle) ? unsupported() : answered(bundle);
        },
        (error) => failed(error),
      );
    },

    async getSocialGraph(request: SocialGraphRequest): Promise<TierOutcome<SocialGraph>> {
      // `contact_list` (extended_response) returns the kind-3 plus the bundled
      // kind-0 of everyone followed — the same shape nagg's social-graph seed has.
      const result = await config.connection.request(
        { verb: 'contact_list', params: { pubkey: request.pubkey, extended_response: true } },
        { signal: request.signal, timeoutMs: request.timeoutMs },
      );
      return result.match<TierOutcome<SocialGraph>>(
        (events) => answered(demuxPrimalSocialGraph(events, request.pubkey)),
        (error) => failed(error),
      );
    },

    async getProfiles(request: ProfilesRequest): Promise<TierOutcome<ProfilesBundle>> {
      if (request.pubkeys.length === 0) return answered({ profiles: {} });
      const result = await config.connection.request(
        { verb: 'user_infos', params: { pubkeys: request.pubkeys } },
        { signal: request.signal, timeoutMs: request.timeoutMs },
      );
      return result.match<TierOutcome<ProfilesBundle>>(
        (events) => answered({ profiles: profilesFromKind0(events) }),
        (error) => failed(error),
      );
    },

    async searchProfiles(request: SearchRequest): Promise<TierOutcome<ProfileSearchBundle>> {
      // Primal's profile-search cache verb returns matched users' kind-0 in
      // relevance order. Unranked (no Vertex pagerank), but a real cache-tier
      // search so cache-only mode isn't stuck on the NIP-50 relay floor.
      const result = await config.connection.request(
        { verb: 'user_search', params: { query: request.query, limit: request.limit ?? 20 } },
        { signal: request.signal, timeoutMs: request.timeoutMs },
      );
      return result.match<TierOutcome<ProfileSearchBundle>>(
        (events) => answered({ hits: profileSearchHitsFromKind0(events) }),
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
  const limit = paging.limit ?? 30;
  const pagedParams = (feedSpec: object, userPubkey?: string): PrimalCacheRequest['params'] => ({
    spec: JSON.stringify(feedSpec),
    limit,
    ...(paging.until ? { until: paging.until } : {}),
    ...(userPubkey ? { user_pubkey: userPubkey } : {}),
  });

  // The `spec` is a Primal `mega_feed_directive` feed spec. Valid notes-feed ids
  // (primal-server app.jl `mega_feed_directive`): global-trending / all-notes /
  // latest / most-zapped / … — NOT an arbitrary id. "for-you" is not a Primal
  // concept, so map it to Primal's closest no-auth algo feed: global trending.
  switch (spec.kind) {
    case 'for-you':
      return {
        verb: 'mega_feed_directive',
        params: pagedParams({ id: 'global-trending', kind: 'notes', hours: 24 }, spec.viewerPubkey),
      };
    case 'following-popular':
      // The viewer's follows feed (Primal's `latest`), keyed by their pubkey;
      // empty when Primal doesn't hold their follow graph → falls to the floor.
      return {
        verb: 'mega_feed_directive',
        params: pagedParams({ id: 'latest', kind: 'notes' }, spec.viewerPubkey),
      };
    case 'following-recent':
    case 'user':
      // No Primal directive wired — fall through to the relay floor (which
      // serves following-recent/user from the author list).
      return null;
  }
}
