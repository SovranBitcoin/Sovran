import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import { latestKind0, type ProfilesBundle, type ProfilesRequest } from '../profiles';
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
import { demuxPrimalProfileStats, demuxPrimalSocialGraph } from './demux';
import type { PrimalConnection } from './protocol';

// ---------------------------------------------------------------------------
// Primal tier (tier 2, "almost as good")
//
// A client adapter to Primal's public cache server: profiles, profile stats,
// the social graph and profile search. A request this tier can't serve returns
// `unsupported` so the facade falls straight through to the raw-relay floor.
// ---------------------------------------------------------------------------

export type PrimalTierConfig = {
  connection: PrimalConnection;
};

export function createPrimalTier(config: PrimalTierConfig): NostrTierStrategy {
  return {
    tier: 'primal',
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
        {
          verb: 'contact_list',
          params: { pubkey: request.pubkey, extended_response: request.withProfiles !== false },
        },
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
        (events) => answered(latestKind0(events)),
        (error) => failed(error),
      );
    },

    // NOTE: the Primal tier deliberately does NOT implement getMintReviews /
    // discoverMints. Primal has no NIP-87 awareness, and its only generic
    // addressable-event store (`parametrized_replaceable_events`) is indexed by
    // (pubkey, kind, identifier/#d) — there is no #u/#k index, so it cannot do the
    // cross-author "all kind-38000 where u=<mintUrl>" aggregate the surface needs.
    // The facade therefore falls straight through to the relay floor, which serves
    // the IDENTICAL MintReviewsSummary shape. Capability ceiling, not a shape gap.

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
