import { answered, failed, type TierOutcome } from '../../tiers';
import {
  summarizeReviews,
  discoverFromReviews,
  MINT_REVIEW_KIND,
  CASHU_MINT_K,
  type DiscoverMintsRequest,
  type DiscoveredMint,
  type MintReviewsRequest,
  type MintReviewsSummary,
} from '../mint-reviews';
import {
  socialGraphFromEvents,
  type SocialGraph,
  type SocialGraphRequest,
} from '../social-graph';
import {
  DM_ENVELOPE_KINDS,
  type DmEnvelope,
  type DmEnvelopesBundle,
  type DmEnvelopesRequest,
} from '../dm';
import { profilesFromKind0, type ProfilesBundle, type ProfilesRequest } from '../profiles';
import {
  profileSearchHitsFromKind0,
  type ProfileSearchBundle,
  type SearchRequest,
} from '../search';
import { toFeedEvent } from '../event';
import type { NaggFeedEvent } from '../../map/feed';
import type { NostrTierStrategy } from '../strategy';
import type { NostrFilter, RawRelayEvent, RelayConnection } from './protocol';

// ---------------------------------------------------------------------------
// Raw-relay tier (tier 3, the floor)
//
// The honest-decentralisation source: mint reviews, the social graph, DM
// envelopes, profiles and NIP-50 profile search straight off relays. Feature
// ceilings are accepted here (no follower counts, unranked search).
// ---------------------------------------------------------------------------

export type RelayTierConfig = {
  connection: RelayConnection;
};

export function createRelayTier(config: RelayTierConfig): NostrTierStrategy {
  return {
    tier: 'relay',
    async getMintReviews(request: MintReviewsRequest): Promise<TierOutcome<MintReviewsSummary>> {
      const filter: NostrFilter = {
        kinds: [MINT_REVIEW_KIND],
        '#k': [CASHU_MINT_K],
        '#u': [request.mintUrl],
        limit: request.limit ?? 100,
      };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<MintReviewsSummary>>(
        (events) => answered(summarizeReviews(request.mintUrl, toFeedEvents(events))),
        (error) => failed(error),
      );
    },

    async discoverMints(request: DiscoverMintsRequest): Promise<TierOutcome<DiscoveredMint[]>> {
      const filter: NostrFilter = {
        kinds: [MINT_REVIEW_KIND],
        '#k': [CASHU_MINT_K],
        limit: request.limit ?? 200,
        ...(request.authors && request.authors.length > 0 ? { authors: request.authors } : {}),
      };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<DiscoveredMint[]>>(
        (events) => answered(discoverFromReviews(toFeedEvents(events))),
        (error) => failed(error),
      );
    },

    async getSocialGraph(request: SocialGraphRequest): Promise<TierOutcome<SocialGraph>> {
      // The viewer's own replaceable lists; profiles are fetched separately (the
      // app batches missing kind-0s), so the floor returns follows/relays/mutes.
      const filter: NostrFilter = {
        kinds: [3, 10_002, 10_000],
        authors: [request.pubkey],
      };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<SocialGraph>>(
        (events) => answered(socialGraphFromEvents(request.pubkey, toFeedEvents(events))),
        (error) => failed(error),
      );
    },

    // NOTE: the relay floor deliberately does NOT implement getProfileStats.
    // Follower counts need a server-side reverse index relays don't have, and
    // even a profile's own kind-3 / joined date is unreliable to fetch off raw
    // relays — so in relay-only mode the facade returns no profile-stats
    // candidate and the app hides the counts rather than showing wrong numbers.

    async getDmEnvelopes(request: DmEnvelopesRequest): Promise<TierOutcome<DmEnvelopesBundle>> {
      // No limit: gift-wrap created_at is randomized. Incremental callers
      // supply an explicit since with their own overlap; default reads stay unbounded.
      const filter: NostrFilter = {
        kinds: DM_ENVELOPE_KINDS,
        '#p': [request.viewerPubkey],
        ...(request.since !== undefined ? { since: request.since } : {}),
      };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<DmEnvelopesBundle>>(
        (events) => {
          const envelopes: DmEnvelope[] = [];
          for (const raw of events) {
            if (typeof raw.id !== 'string' || typeof raw.pubkey !== 'string') continue;
            envelopes.push({
              id: raw.id,
              pubkey: raw.pubkey,
              kind: raw.kind,
              content: typeof raw.content === 'string' ? raw.content : '',
              tags: Array.isArray(raw.tags) ? (raw.tags as string[][]) : [],
              createdAtSec: typeof raw.created_at === 'number' ? raw.created_at : 0,
            });
          }
          // Relay can't paginate gift wraps by arrival → no cursor.
          return answered({ envelopes, cursor: null });
        },
        (error) => failed(error),
      );
    },

    dmLiveSubscribe(
      request: DmEnvelopesRequest,
      onEnvelope: (envelope: DmEnvelope) => void,
    ): () => void {
      // Live counterpart of getDmEnvelopes: an open REQ for the viewer's DM
      // wraps that stays past EOSE. Same NO since/limit reasoning (gift-wrap
      // created_at is randomized). The relay `subscribe` dedupes by id, so
      // repeat wraps never double-fire.
      if (!config.connection.subscribe) return () => {};
      const filters: NostrFilter[] = [
        { kinds: DM_ENVELOPE_KINDS, '#p': [request.viewerPubkey] },
      ];
      return config.connection.subscribe(filters, (raw) => {
        if (typeof raw.id !== 'string' || typeof raw.pubkey !== 'string') return;
        onEnvelope({
          id: raw.id,
          pubkey: raw.pubkey,
          kind: raw.kind,
          content: typeof raw.content === 'string' ? raw.content : '',
          tags: Array.isArray(raw.tags) ? (raw.tags as string[][]) : [],
          createdAtSec: typeof raw.created_at === 'number' ? raw.created_at : 0,
        });
      });
    },

    async getProfiles(request: ProfilesRequest): Promise<TierOutcome<ProfilesBundle>> {
      if (request.pubkeys.length === 0) return answered({ profiles: {} });
      const filter: NostrFilter = { kinds: [0], authors: request.pubkeys };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ProfilesBundle>>(
        (events) => answered({ profiles: profilesFromKind0(events) }),
        (error) => failed(error),
      );
    },

    async searchProfiles(request: SearchRequest): Promise<TierOutcome<ProfileSearchBundle>> {
      // NIP-50 floor: relays that advertise it full-text-search kind-0; the rest
      // ignore `search` and return nothing. Unranked — no global pagerank here.
      const filter: NostrFilter = {
        kinds: [0],
        search: request.query,
        limit: request.limit ?? 20,
      };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ProfileSearchBundle>>(
        (events) => answered({ hits: profileSearchHitsFromKind0(events) }),
        (error) => failed(error),
      );
    },
  };
}

function toFeedEvents(events: ReadonlyArray<RawRelayEvent>): NaggFeedEvent[] {
  const out: NaggFeedEvent[] = [];
  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (event) out.push(event);
  }
  return out;
}
