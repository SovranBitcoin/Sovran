import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import type { FeedBundle, FeedPageRequest, FeedSpec } from '../feed';
import type { ThreadBundle, ThreadRequest } from '../thread';
import type { NotificationsBundle, NotificationsRequest } from '../notifications';
import { ownActionKinds, type OwnHistoryBundle, type OwnHistoryRequest } from '../own-state';
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
import { toFeedEvent } from '../event';
import type { NaggFeedEvent } from '../../map/feed';
import type { NostrTierStrategy } from '../strategy';
import { demuxRelayFeed, demuxRelayThread, demuxRelayNotifications, demuxRelayOwnHistory } from './demux';
import type { NostrFilter, RawRelayEvent, RelayConnection } from './protocol';

// ---------------------------------------------------------------------------
// Raw-relay tier (tier 3, the floor)
//
// The honest-decentralisation source. Feature ceilings are accepted here, per
// the per-surface matrix: For-You is OUT OF REACH on relays, so it degrades to
// a recent feed; a spec that needs server-side context the floor can't provide
// returns `unsupported` (the engine has already exhausted the better tiers by
// the time we reach the floor, so unsupported there surfaces as an honest error).
// ---------------------------------------------------------------------------

export type RelayTierConfig = {
  connection: RelayConnection;
};

export function createRelayTier(config: RelayTierConfig): NostrTierStrategy {
  return {
    tier: 'relay',
    async feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>> {
      const filters = filtersForSpec(request.spec, {
        until: request.cursor?.createdAt,
        limit: request.limit,
      });
      if (!filters) return unsupported();

      const result = await config.connection.request(filters, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<FeedBundle>>(
        (events) => answered(demuxRelayFeed(events)),
        (error) => failed(error),
      );
    },

    async thread(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>> {
      // The root by id, plus its direct replies (#e references to it). The floor
      // can't rank — replies render newest-first via the synthesized manifest.
      const filters: NostrFilter[] = [
        { ids: [request.noteId] },
        { kinds: [1], '#e': [request.noteId], limit: request.limit ?? 100 },
      ];
      const result = await config.connection.request(filters, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ThreadBundle>>(
        (events) => {
          const bundle = demuxRelayThread(events, request.noteId);
          return bundle ? answered(bundle) : unsupported();
        },
        (error) => failed(error),
      );
    },

    async notifications(request: NotificationsRequest): Promise<TierOutcome<NotificationsBundle>> {
      const limit = request.limit ?? 50;
      const filters: NostrFilter[] = [
        // engagement + mentions that p-tag me
        {
          kinds: [1, 6, 7, 9735],
          '#p': [request.viewerPubkey],
          limit,
          ...(request.since ? { since: request.since } : {}),
          ...(request.cursor?.createdAt ? { until: request.cursor.createdAt } : {}),
        },
      ];
      // The load-bearing #e backstop: replies/engagement that omit #p but reference my events.
      if (request.ownEventIds && request.ownEventIds.length > 0) {
        filters.push({ kinds: [1], '#e': request.ownEventIds, limit });
      }

      const result = await config.connection.request(filters, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<NotificationsBundle>>(
        (events) => answered(demuxRelayNotifications(events, request.viewerPubkey, request.ownEventIds)),
        (error) => failed(error),
      );
    },

    async ownHistory(request: OwnHistoryRequest): Promise<TierOutcome<OwnHistoryBundle>> {
      // A zap receipt isn't authored by the sender, so the floor can't cleanly
      // list zaps-sent (it would have to scan every 9735) — accepted ceiling.
      if (request.actionType === 'zaps-sent') return unsupported();

      const filter: NostrFilter = {
        kinds: ownActionKinds(request.actionType),
        authors: [request.viewerPubkey],
        limit: request.limit ?? 100,
        ...(request.cursor?.createdAt ? { until: request.cursor.createdAt } : {}),
      };
      const result = await config.connection.request([filter], {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<OwnHistoryBundle>>(
        (events) => answered(demuxRelayOwnHistory(events, request.actionType)),
        (error) => failed(error),
      );
    },

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

function filtersForSpec(
  spec: FeedSpec,
  paging: { until?: number; limit?: number },
): NostrFilter[] | null {
  switch (spec.kind) {
    case 'for-you':
      // For-You can't be ranked on the floor — degrade to recent global notes.
      return [
        {
          kinds: [1],
          limit: paging.limit ?? 30,
          ...(paging.until ? { until: paging.until } : {}),
        },
      ];
    case 'following-popular':
      // Needs the viewer's follow list (kind 3) resolved first — handled once the
      // social-graph surface lands; until then, fall through.
      return null;
  }
}
