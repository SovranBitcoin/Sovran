import type { NostrCursor } from '@sovranbitcoin/schemas';
import { answered, failed, unsupported, type TierOutcome } from '../../tiers';
import type { FeedBundle, FeedItem, FeedPageRequest, FeedSpec } from '../feed';
import type { SortKey } from '../session/page-buffer';
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
import { demuxRelayFeed, demuxRelayThread, demuxRelayNotifications, demuxRelayOwnHistory } from './demux';
import { buildRelayForYouFeed } from './for-you/build';
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
      // For-You is normally OUT OF REACH on the floor, but the viewer's own likes
      // are a relay-native ranking signal: build a personalized feed from the
      // accounts they like (one hop / curated cold-start when likes are thin).
      // Null = no usable signal → fall through to the honest recency degrade below.
      if (request.spec.kind === 'for-you' && request.spec.viewerPubkey) {
        const forYou = await buildRelayForYouFeed({
          viewerPubkey: request.spec.viewerPubkey,
          connection: config.connection,
          request,
        });
        if (forYou) return answered(forYou);
      }

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
        (events) => answered(demuxRelayFeed(withoutBoundary(events, request.cursor))),
        (error) => failed(error),
      );
    },

    feedLiveSubscribe(
      request: FeedPageRequest,
      since: SortKey | undefined,
      onItems: (items: readonly FeedItem[]) => void,
    ): () => void {
      // The one explicit relay seam: stream NEWER notes for the "Load new" pill.
      // Pages still come from the best tier; only the live delta is relay-only.
      if (!config.connection.subscribe) return () => {};
      const filters = filtersForSpec(request.spec, { since: since?.createdAt });
      if (!filters) return () => {};
      // Drop the page-size limit for a live sub; it's an open stream, not a page.
      const liveFilters = filters.map(({ limit: _limit, ...rest }) => rest);
      return config.connection.subscribe(liveFilters, (raw) => {
        const event = toFeedEvent(raw);
        if (!event) return;
        onItems([{ type: 'note', event }]);
      });
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
      if (result.isErr()) return failed(result.error);
      let events: ReadonlyArray<RawRelayEvent> = result.value;

      // Second phase: fetch the root's ANCESTORS (its NIP-10 `e` referents — the
      // thread root + immediate parent), so the parent context renders AND caches.
      // The floor has no server-side thread view, so without this the parent of a
      // tapped reply isn't in the cache and flashes in from the network.
      const ancestorIds = rootAncestorIds(events, request.noteId);
      if (ancestorIds.length > 0) {
        const ancestors = await config.connection.request([{ ids: ancestorIds }], {
          signal: request.signal,
          timeoutMs: request.timeoutMs,
        });
        if (ancestors.isOk()) events = [...events, ...ancestors.value];
      }

      // Third phase: batch kind-0 for every author (now including ancestors), so
      // relay-mode threads render pfp/name. Tolerate a profile-fetch failure —
      // render the notes rather than failing the thread.
      events = await withThreadAuthorProfiles(config.connection, events, request);
      const bundle = demuxRelayThread(events, request.noteId);
      return bundle ? answered(bundle) : unsupported();
    },

    async notifications(request: NotificationsRequest): Promise<TierOutcome<NotificationsBundle>> {
      const limit = request.limit ?? 50;
      const isMentions = request.tab === 'MENTIONS';
      const bounds = {
        ...(request.since ? { since: request.since } : {}),
        ...(request.cursor?.createdAt ? { until: request.cursor.createdAt } : {}),
      };
      // MENTIONS is replies + quotes + @-mentions (all kind-1); ALL also carries
      // reaction/repost/zap. The demux is the source of truth on tab semantics —
      // these filters just avoid pulling engagement kinds we'd discard.
      const filters: NostrFilter[] = [
        { kinds: isMentions ? [1] : [1, 6, 7, 9735], '#p': [request.viewerPubkey], limit, ...bounds },
      ];
      // The load-bearing #e backstop: replies/engagement that omit #p but reference
      // my events. It MUST page with the same since/until as the primary filter, or
      // every page re-fetches the full backstop set from newest (stale duplicates).
      if (request.ownEventIds && request.ownEventIds.length > 0) {
        filters.push({ kinds: [1], '#e': request.ownEventIds, limit, ...bounds });
        // Quotes of my events that don't p-tag me (NIP-18 q reference).
        filters.push({ kinds: [1], '#q': request.ownEventIds, limit, ...bounds });
      }

      const result = await config.connection.request(filters, {
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<NotificationsBundle>>(
        (events) =>
          answered(
            demuxRelayNotifications(
              withoutBoundary(events, request.cursor),
              request.viewerPubkey,
              request.ownEventIds,
              { tab: request.tab, replyScope: request.replyScope },
            ),
          ),
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
        (events) => answered(demuxRelayOwnHistory(withoutBoundary(events, request.cursor), request.actionType)),
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

    // NOTE: the relay floor deliberately does NOT implement getProfileStats.
    // Follower counts need a server-side reverse index relays don't have, and
    // even a profile's own kind-3 / joined date is unreliable to fetch off raw
    // relays — so in relay-only mode the facade returns no profile-stats
    // candidate and the app hides the counts rather than showing wrong numbers.

    async getDmEnvelopes(request: DmEnvelopesRequest): Promise<TierOutcome<DmEnvelopesBundle>> {
      // Gift-wrap created_at is randomized into the past, so NO since/limit — they
      // would silently drop old conversations. Pure opaque-envelope transport.
      const filter: NostrFilter = {
        kinds: DM_ENVELOPE_KINDS,
        '#p': [request.viewerPubkey],
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
              createdAt: typeof raw.created_at === 'number' ? raw.created_at : 0,
            });
          }
          // Relay can't paginate gift wraps by arrival → no cursor.
          return answered({ envelopes, cursor: null });
        },
        (error) => failed(error),
      );
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

/**
 * Drop the exact boundary event the previous page already showed. NIP-01 `until`
 * is INCLUSIVE, so paging with `until: cursor.createdAt` re-returns the cursor's
 * own event at the top of the next page; the cursor carries `id` precisely to
 * disambiguate it. Same-second siblings (different ids) are kept.
 */
function withoutBoundary(
  events: ReadonlyArray<RawRelayEvent>,
  cursor: NostrCursor | undefined,
): ReadonlyArray<RawRelayEvent> {
  return cursor ? events.filter((e) => e.id !== cursor.id) : events;
}

/** The root note's NIP-10 `e` referents (thread root + immediate parent) to fetch as ancestors. */
function rootAncestorIds(events: ReadonlyArray<RawRelayEvent>, rootId: string): string[] {
  const root = events.find((event) => event.id === rootId);
  if (!root || !Array.isArray(root.tags)) return [];
  const ids = new Set<string>();
  for (const tag of root.tags as unknown[]) {
    if (Array.isArray(tag) && tag[0] === 'e' && typeof tag[1] === 'string' && tag[1] !== rootId) {
      ids.add(tag[1]);
    }
  }
  return [...ids];
}

/**
 * Batch a kind-0 fetch for every author in a thread's events and append the
 * results, so the relay floor's thread path resolves pfp/name. A profile-fetch
 * failure is tolerated — the notes still render, authors just stay unresolved.
 */
async function withThreadAuthorProfiles(
  connection: RelayConnection,
  events: ReadonlyArray<RawRelayEvent>,
  request: ThreadRequest,
): Promise<ReadonlyArray<RawRelayEvent>> {
  const authors = [
    ...new Set(
      events
        .filter((event) => event.kind !== 0)
        .map((event) => event.pubkey)
        .filter((pubkey): pubkey is string => typeof pubkey === 'string'),
    ),
  ];
  if (authors.length === 0) return events;
  const result = await connection.request([{ kinds: [0], authors }], {
    signal: request.signal,
    timeoutMs: request.timeoutMs,
  });
  return result.match(
    (profiles) => [...events, ...profiles],
    () => events,
  );
}

function toFeedEvents(events: ReadonlyArray<RawRelayEvent>): NaggFeedEvent[] {
  const out: NaggFeedEvent[] = [];
  for (const raw of events) {
    const event = toFeedEvent(raw);
    if (event) out.push(event);
  }
  return out;
}

export function filtersForSpec(
  spec: FeedSpec,
  paging: { until?: number; since?: number; limit?: number },
): NostrFilter[] | null {
  const bounds = {
    ...(paging.until ? { until: paging.until } : {}),
    ...(paging.since ? { since: paging.since } : {}),
  };
  switch (spec.kind) {
    case 'for-you':
      // For-You can't be ranked on the floor — degrade to recent global notes.
      return [{ kinds: [1], limit: paging.limit ?? 30, ...bounds }];
    case 'following-popular':
      // Needs the viewer's follow list (kind 3) resolved first — handled once the
      // social-graph surface lands; until then, fall through.
      return null;
    case 'following-recent':
      // The caller already resolved the author list, so the floor can serve it.
      if (spec.authors.length === 0) return null;
      return [{ kinds: [1], authors: spec.authors, limit: paging.limit ?? 30, ...bounds }];
    case 'user':
      return [{ kinds: [1], authors: [spec.pubkey], limit: paging.limit ?? 30, ...bounds }];
  }
}
