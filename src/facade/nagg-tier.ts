import type { NaggClient } from '../transport';
import { NaggFeedPageSchema, NaggThreadSchema, NaggNotificationsPageSchema } from '../schemas';
import { rankedFeedAppView, threadAppView, notificationsAppView } from '../recipes/appview-feed';
import { forYouRankedEventsInput, followingPopularRankedEventsInput } from '../recipes/feed';
import type { NaggFeedPage } from '../map/feed';
import { answered, failed, type TierOutcome } from '../tiers';
import {
  bundleFromFeedPage,
  type FeedBundle,
  type FeedPageRequest,
  type FeedSpec,
} from './feed';
import { bundleFromThread, type ThreadBundle, type ThreadRequest, type ThreadSource } from './thread';
import {
  bundleFromNotifications,
  type NotificationsBundle,
  type NotificationsRequest,
  type NotificationsSource,
} from './notifications';
import {
  bundleFromOwnEvents,
  OwnHistoryResponseSchema,
  type OwnHistoryBundle,
  type OwnHistoryRequest,
} from './own-state';
import {
  MintReviewsResponseSchema,
  DiscoverMintsResponseSchema,
  type DiscoverMintsRequest,
  type DiscoveredMint,
  type MintReviewsRequest,
  type MintReviewsSummary,
} from './mint-reviews';
import {
  SocialGraphResponseSchema,
  socialGraphFromResponse,
  type SocialGraph,
  type SocialGraphRequest,
} from './social-graph';
import {
  bundleFromNaggDmNodes,
  DM_ENVELOPE_KINDS,
  type DmEnvelopesBundle,
  type DmEnvelopesRequest,
} from './dm';
import { NaggDmEnvelopesDataSchema } from '../schemas';
import { dmEnvelopesAppView } from '../recipes/dm';
import type { NostrTierStrategy } from './strategy';

// ---------------------------------------------------------------------------
// nagg tier (tier 1, gold)
//
// Our own app-view: fully bundled + server-ranked. The richest tier — it answers
// every read. This adapter reuses the existing ranked-feed recipe + canonical
// `NaggFeedPageSchema`, served over nagg's REST app-view via `client.rest`, and
// bridges the (already-ordered) response into the contract `FeedBundle`.
//
// Cross-tier fallback (nagg → Primal → relay) is the FACADE's job; within this
// tier we use the REST app-view as the primary transport. (The in-nagg
// appview→GraphQL fallback the app does today moves here in a follow-up, once
// the ranked GraphQL query is ported down from sovran-app.)
// ---------------------------------------------------------------------------

export type NaggTierConfig = {
  client: NaggClient;
};

export function createNaggTier(config: NaggTierConfig): NostrTierStrategy {
  const { client } = config;

  return {
    tier: 'nagg',
    async feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>> {
      const binding = rankedBindingForSpec(request);
      const result = await client.rest<typeof NaggFeedPageSchema>({
        path: binding.path,
        method: binding.method ?? 'POST',
        body: binding.body,
        responseSchema: NaggFeedPageSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<FeedBundle>>(
        (page) => answered(bundleFromFeedPage(page as NaggFeedPage)),
        (error) => failed(error),
      );
    },

    async thread(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>> {
      const binding = threadAppView({ id: request.noteId, limit: request.limit });
      const result = await client.rest<typeof NaggThreadSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggThreadSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ThreadBundle>>(
        (thread) => answered(bundleFromThread(thread as ThreadSource)),
        (error) => failed(error),
      );
    },

    async notifications(request: NotificationsRequest): Promise<TierOutcome<NotificationsBundle>> {
      const grouped = request.grouped !== false;
      const binding = notificationsAppView({
        pubkey: request.viewerPubkey,
        tab: request.tab,
        policy: request.policy,
        replyScope: request.replyScope,
        since: request.since,
        until: request.cursor?.createdAt,
        limit: request.limit,
        grouped,
      });
      const result = await client.rest<typeof NaggNotificationsPageSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggNotificationsPageSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<NotificationsBundle>>(
        (page) => answered(bundleFromNotifications(page as NotificationsSource, grouped)),
        (error) => failed(error),
      );
    },

    async ownHistory(request: OwnHistoryRequest): Promise<TierOutcome<OwnHistoryBundle>> {
      // nagg is the only tier that fully covers own-state (it stores reactions/
      // reposts/zaps). One paginated endpoint per action type, cursor = until+id.
      const result = await client.rest<typeof OwnHistoryResponseSchema>({
        path: `/nostr/own/${request.actionType}`,
        method: 'GET',
        searchParams: {
          pubkey: request.viewerPubkey,
          ...(request.cursor?.createdAt ? { until: request.cursor.createdAt } : {}),
          ...(request.cursor?.id ? { cursorId: request.cursor.id } : {}),
          limit: request.limit ?? 100,
        },
        responseSchema: OwnHistoryResponseSchema,
        operationName: `OwnHistory:${request.actionType}`,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<OwnHistoryBundle>>(
        (page) => answered(bundleFromOwnEvents(page.events)),
        (error) => failed(error),
      );
    },

    async getMintReviews(request: MintReviewsRequest): Promise<TierOutcome<MintReviewsSummary>> {
      // Server-side per-mint aggregate (GroupBy:["u"]) — kills the per-result N+1.
      const result = await client.rest<typeof MintReviewsResponseSchema>({
        path: '/nostr/mint/reviews',
        method: 'GET',
        searchParams: { u: request.mintUrl, ...(request.limit ? { limit: request.limit } : {}) },
        responseSchema: MintReviewsResponseSchema,
        operationName: 'MintReviews',
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<MintReviewsSummary>>(
        (page) =>
          answered({
            mintUrl: page.summary.mintUrl,
            averageScore: page.summary.averageScore,
            reviewCount: page.summary.reviewCount,
            reviews: [], // the aggregate gives avg+count; individual reviews come from a lower tier
          }),
        (error) => failed(error),
      );
    },

    async discoverMints(request: DiscoverMintsRequest): Promise<TierOutcome<DiscoveredMint[]>> {
      const result = await client.rest<typeof DiscoverMintsResponseSchema>({
        path: '/nostr/mint/discover',
        method: 'GET',
        searchParams: {
          ...(request.limit ? { limit: request.limit } : {}),
          ...(request.authors && request.authors.length > 0 ? { authors: request.authors } : {}),
        },
        responseSchema: DiscoverMintsResponseSchema,
        operationName: 'DiscoverMints',
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<DiscoveredMint[]>>(
        (page) => answered(page.mints),
        (error) => failed(error),
      );
    },

    async getSocialGraph(request: SocialGraphRequest): Promise<TierOutcome<SocialGraph>> {
      // One bundled response: follows + each follow's profile + relay/mute lists.
      const result = await client.rest<typeof SocialGraphResponseSchema>({
        path: '/nostr/social-graph',
        method: 'GET',
        searchParams: { pubkey: request.pubkey },
        responseSchema: SocialGraphResponseSchema,
        operationName: 'SocialGraph',
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<SocialGraph>>(
        (data) => answered(socialGraphFromResponse(data)),
        (error) => failed(error),
      );
    },

    async getDmEnvelopes(request: DmEnvelopesRequest): Promise<TierOutcome<DmEnvelopesBundle>> {
      // Index/router only — opaque envelopes, paginated by ingest time. nagg
      // stores arrival time so an incremental sync CAN bound against it.
      const binding = dmEnvelopesAppView({
        viewer: request.viewerPubkey,
        kinds: DM_ENVELOPE_KINDS,
        until: request.cursor?.createdAt,
        limit: request.limit,
      });
      const result = await client.rest<typeof NaggDmEnvelopesDataSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggDmEnvelopesDataSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<DmEnvelopesBundle>>(
        (data) => answered(bundleFromNaggDmNodes(data.dmEnvelopes.nodes)),
        (error) => failed(error),
      );
    },
  };
}

function rankedBindingForSpec(request: FeedPageRequest) {
  const until = request.cursor?.createdAt;
  const limit = request.limit;
  const input = rankedInputForSpec(request.spec, { until, limit });
  return rankedFeedAppView(input);
}

function rankedInputForSpec(
  spec: FeedSpec,
  paging: { until?: number; limit?: number },
) {
  switch (spec.kind) {
    case 'for-you':
      return forYouRankedEventsInput({
        viewerPubkey: spec.viewerPubkey,
        until: paging.until,
        limit: paging.limit,
      });
    case 'following-popular':
      return followingPopularRankedEventsInput({
        viewerPubkey: spec.viewerPubkey,
        until: paging.until,
        limit: paging.limit,
      });
  }
}
