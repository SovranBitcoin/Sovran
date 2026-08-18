import { errAsync } from 'neverthrow';
import type { z } from 'zod';

import type { NaggClient, NaggRestRequest } from '../transport';
import type { NaggError } from '../errors';
import {
  NaggEnvelopeSchema,
  NaggThreadEnvelopeSchema,
  NaggNotificationsEnvelopeSchema,
  NaggProfilesEnvelopeSchema,
  feedPageFromEnvelope,
  threadFromEnvelope,
  notificationsPageFromEnvelope,
  orderedEnvelopeEvents,
  profileInfoMapFromEnvelope,
} from '../envelope';
import {
  rankedFeedAppView,
  followsFeedAppView,
  userFeedAppView,
  threadAppView,
  notificationsAppView,
} from '../recipes/appview-feed';
import { forYouRankedEventsInput, followingPopularRankedEventsInput } from '../recipes/feed';
import { answered, failed, unsupported, type TierOutcome } from '../tiers';
import { nostrLog } from '../log';
import {
  bundleFromFeedPage,
  type FeedBundle,
  type FeedPageRequest,
} from './feed';
import { bundleFromThread, type ThreadBundle, type ThreadRequest } from './thread';
import {
  bundleFromNotifications,
  type NotificationsBundle,
  type NotificationsRequest,
} from './notifications';
import {
  bundleFromOwnEvents,
  type OwnHistoryBundle,
  type OwnHistoryRequest,
} from './own-state';
import {
  MintReviewsResponseSchema,
  DiscoverMintsResponseSchema,
  type DiscoverMintsRequest,
  type DiscoveredMint,
  type MintReview,
  type MintReviewsRequest,
  type MintReviewsSummary,
} from './mint-reviews';
import {
  socialGraphFromEvents,
  type SocialGraph,
  type SocialGraphRequest,
} from './social-graph';
import {
  bundleFromDmEnvelope,
  DM_ENVELOPE_KINDS,
  type DmEnvelopesBundle,
  type DmEnvelopesRequest,
} from './dm';
import { dmEnvelopesAppView } from '../recipes/dm';
import {
  searchHitsFromEnvelope,
  type ProfileSearchBundle,
  type SearchRequest,
} from './search';
import { profileSearchAppView } from '../recipes/profile-search';
import type { NostrTierStrategy } from './strategy';

// ---------------------------------------------------------------------------
// nagg tier (tier 1, gold)
//
// Our own app-view: fully bundled + server-ranked. The richest tier — it answers
// every read. nagg v2 serves EVERY route as the ONE generic envelope
// (`{ order, orderBy, events, aggregates, cursor? }`), so this adapter parses
// each response with the shared `NaggEnvelopeSchema` (plus the route's
// extension where one exists) and reconstructs the canonical facade bundles
// through `src/envelope.ts` — there are no per-route response schemas anymore.
//
// Cross-tier fallback (nagg → Primal → relay) is the FACADE's job; within this
// tier the REST app-view is the only transport. The mint routes are NOT part of
// the v2 envelope migration and keep their bespoke response schemas.
// ---------------------------------------------------------------------------

export type NaggTierConfig = {
  client: NaggClient;
};

/**
 * Cooldown circuit-breaker: after CONSECUTIVE network failures (fetch failed
 * or timed out — NOT a caller abort, NOT an HTTP/schema error, which prove
 * the server is reachable), every nagg read short-circuits for this long
 * instead of paying the full request timeout again. Without it, each read
 * independently burned the whole timeout against a dead nagg before falling
 * through to Primal/relay — a 30s stall per query while nagg was down.
 *
 * The threshold exists because a slow-but-alive nagg is NOT a dead nagg: a
 * single heavy read (cold ranked feed) exceeding its per-request timeout must
 * only fail over THAT read, not poison every nagg read for 30s — that traded
 * the gold tier away for speed on the whole session. A genuinely hung nagg
 * fails every request, so it still opens the breaker on the second failure;
 * any success closes it.
 */
const NAGG_COOLDOWN_MS = 30_000;
const NAGG_COOLDOWN_THRESHOLD = 2;

/**
 * Headroom the thread candidate pool reserves for the relevant merge's
 * author tier (all OP direct replies) on top of the requested page window.
 */
const RELEVANT_AUTHOR_REPLY_LIMIT = 50;

function withCooldown(rawClient: NaggClient): NaggClient {
  let cooldownUntil = 0;
  let consecutiveNetworkFailures = 0;
  return {
    appViewBaseUrl: rawClient.appViewBaseUrl,
    rest: <TSchema extends z.ZodType>(request: NaggRestRequest<TSchema>) => {
      const now = Date.now();
      if (now < cooldownUntil) {
        nostrLog.debug('nostr.tier.cooldown', {
          tier: 'nagg',
          remainingMs: Math.round(cooldownUntil - now),
        });
        return errAsync<z.infer<TSchema>, NaggError>({
          type: 'network',
          message: 'nagg is cooling down after repeated network failures',
          cause: 'cooldown',
        });
      }
      return rawClient.rest(request)
        .map((value) => {
          consecutiveNetworkFailures = 0;
          return value;
        })
        .mapErr((error) => {
          // A caller abort (navigation away) says nothing about nagg's health.
          if (error.type === 'network' && request.signal?.aborted !== true) {
            consecutiveNetworkFailures += 1;
            if (consecutiveNetworkFailures >= NAGG_COOLDOWN_THRESHOLD) {
              cooldownUntil = Date.now() + NAGG_COOLDOWN_MS;
              nostrLog.warn('nostr.tier.cooldown_armed', {
                tier: 'nagg',
                cooldownMs: NAGG_COOLDOWN_MS,
                consecutiveFailures: consecutiveNetworkFailures,
              });
            }
          } else if (error.type !== 'network') {
            // An HTTP/schema answer proves the server is alive.
            consecutiveNetworkFailures = 0;
          }
          return error;
        });
    },
  };
}

export function createNaggTier(config: NaggTierConfig): NostrTierStrategy {
  const client = withCooldown(config.client);

  return {
    tier: 'nagg',
    async feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>> {
      const binding = feedBindingForSpec(request);
      nostrLog.debug('nostr.nagg.feed', { path: binding.path, spec: request.spec.kind });
      const result = await client.rest<typeof NaggEnvelopeSchema>({
        path: binding.path,
        method: binding.method ?? 'POST',
        body: binding.body,
        searchParams: binding.searchParams,
        responseSchema: NaggEnvelopeSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<FeedBundle>>(
        (envelope) => {
          const bundle = bundleFromFeedPage(feedPageFromEnvelope(envelope));
          // An empty feed page isn't a useful answer — fall through to the next
          // tier so a quiet/unavailable nagg appview doesn't blank the feed.
          if (bundle.itemsById.size === 0) {
            nostrLog.debug('nostr.nagg.feed.empty');
            return unsupported();
          }
          return answered(bundle);
        },
        (error) => failed(error),
      );
    },

    async thread(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>> {
      // Full ranked-thread parity with the server: sort/viewer trigger the
      // relevant merge (OP direct replies pinned), offset/replyLimit window
      // the ordered manifest, candidateLimit bounds the merge pool. The fetch
      // cap (`limit`) is only sent when the caller asks — the server default
      // (1000) must apply for replyLimit=0 full-manifest reads, or the stack
      // would silently truncate at the merge pool size.
      const offset = request.offset ?? 0;
      const replyLimit = request.replyLimit ?? 0;
      const candidateLimit = Math.max(100, offset + replyLimit + RELEVANT_AUTHOR_REPLY_LIMIT + 1);
      const binding = threadAppView({
        id: request.noteId,
        ...(request.limit ? { limit: request.limit } : {}),
        sort: request.sort ?? 'relevant',
        viewer: request.viewerPubkey,
        offset,
        replyLimit,
        candidateLimit,
        rankedLimit: Math.min(candidateLimit, 50),
      });
      nostrLog.debug('nostr.nagg.thread', { path: binding.path });
      const result = await client.rest<typeof NaggThreadEnvelopeSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggThreadEnvelopeSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<ThreadBundle>>(
        (envelope) => {
          // order[0] is the root id; a missing/unhydrated root means nagg has
          // nothing to render — fall through to the next tier.
          const thread = threadFromEnvelope(envelope);
          if (!thread) {
            nostrLog.debug('nostr.nagg.thread.empty', { noteId: request.noteId.slice(0, 8) });
            return unsupported();
          }
          return answered(bundleFromThread(thread));
        },
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
      nostrLog.debug('nostr.nagg.notifications', { path: binding.path, grouped });
      const result = await client.rest<typeof NaggNotificationsEnvelopeSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggNotificationsEnvelopeSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<NotificationsBundle>>(
        (envelope) =>
          answered(bundleFromNotifications(notificationsPageFromEnvelope(envelope), grouped)),
        (error) => failed(error),
      );
    },

    async ownHistory(request: OwnHistoryRequest): Promise<TierOutcome<OwnHistoryBundle>> {
      // nagg is the only tier that fully covers own-state (it stores reactions/
      // reposts/zaps). One paginated endpoint per action type, cursor = until+id.
      nostrLog.debug('nostr.nagg.ownHistory', { actionType: request.actionType });
      const result = await client.rest<typeof NaggEnvelopeSchema>({
        path: `/nostr/own/${request.actionType}`,
        method: 'GET',
        searchParams: {
          pubkey: request.viewerPubkey,
          ...(request.cursor?.createdAt ? { until: request.cursor.createdAt } : {}),
          ...(request.cursor?.id ? { cursorId: request.cursor.id } : {}),
          limit: request.limit ?? 100,
        },
        responseSchema: NaggEnvelopeSchema,
        operationName: `OwnHistory:${request.actionType}`,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      // `order` lists the action events; hydration (kind-0 profiles etc.) stays
      // out of the history by resolving through it.
      return result.match<TierOutcome<OwnHistoryBundle>>(
        (envelope) => answered(bundleFromOwnEvents(orderedEnvelopeEvents(envelope))),
        (error) => failed(error),
      );
    },

    async getMintReviews(request: MintReviewsRequest): Promise<TierOutcome<MintReviewsSummary>> {
      // Server-side per-mint aggregate (GroupBy:["u"]) — kills the per-result N+1.
      nostrLog.debug('nostr.nagg.mintReviews', { mintUrl: request.mintUrl });
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
        (page) => {
          const profiles = page.profiles ?? {};
          const reviews: MintReview[] = (page.reviews ?? []).map((item) => {
            const profile = profiles[item.reviewerPubkey];
            return {
              eventId: item.eventId,
              reviewerPubkey: item.reviewerPubkey,
              mintUrl: item.mintUrl,
              score: item.score,
              content: item.content,
              createdAt: item.createdAt,
              ...(profile?.name ? { name: profile.name } : {}),
              ...(profile?.picture ? { picture: profile.picture } : {}),
            };
          });
          return answered({
            mintUrl: page.summary.mintUrl,
            averageScore: page.summary.averageScore,
            reviewCount: page.summary.reviewCount,
            reviews,
          });
        },
        (error) => failed(error),
      );
    },

    async discoverMints(request: DiscoverMintsRequest): Promise<TierOutcome<DiscoveredMint[]>> {
      nostrLog.debug('nostr.nagg.discoverMints', { limit: request.limit ?? null });
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
        (page) => {
          const profiles = page.profiles ?? {};
          const mints: DiscoveredMint[] = page.mints.map((m) => {
            const operator = m.operatorPubkey ? profiles[m.operatorPubkey] : undefined;
            return {
              mintUrl: m.mintUrl,
              averageScore: m.averageScore,
              reviewCount: m.reviewCount,
              favouriteCount: m.favouriteCount ?? 0,
              ...(m.name ? { name: m.name } : {}),
              ...(m.iconUrl ? { iconUrl: m.iconUrl } : {}),
              ...(m.description ? { description: m.description } : {}),
              ...(m.supportedUnits ? { supportedUnits: m.supportedUnits } : {}),
              ...(m.hasAudit != null ? { hasAudit: m.hasAudit } : {}),
              ...(m.state ? { state: m.state } : {}),
              ...(m.nMints != null ? { nMints: m.nMints } : {}),
              ...(m.nMelts != null ? { nMelts: m.nMelts } : {}),
              ...(m.nErrors != null ? { nErrors: m.nErrors } : {}),
              ...(m.operatorPubkey ? { operatorPubkey: m.operatorPubkey } : {}),
              ...(m.operatorNpub ? { operatorNpub: m.operatorNpub } : {}),
              ...(operator?.name ? { operatorName: operator.name } : {}),
              ...(operator?.picture ? { operatorPicture: operator.picture } : {}),
              ...(m.followers != null ? { followers: m.followers } : {}),
              ...(m.follows != null ? { follows: m.follows } : {}),
              ...(m.vertexRank != null ? { vertexRank: m.vertexRank } : {}),
              ...(m.vertexScore !== undefined ? { vertexScore: m.vertexScore } : {}),
            };
          });
          return answered(mints);
        },
        (error) => failed(error),
      );
    },

    async getSocialGraph(request: SocialGraphRequest): Promise<TierOutcome<SocialGraph>> {
      // One bundled response: follows + each follow's profile + relay/mute lists.
      nostrLog.debug('nostr.nagg.socialGraph', { pubkey: request.pubkey.slice(0, 8) });
      const result = await client.rest<typeof NaggEnvelopeSchema>({
        path: '/nostr/social-graph',
        method: 'GET',
        searchParams: { pubkey: request.pubkey },
        responseSchema: NaggEnvelopeSchema,
        operationName: 'SocialGraph',
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<SocialGraph>>(
        (envelope) => {
          // v2 returns the raw latest kind-3 / 10002 / 10000 events; derive the
          // lists from their tags. No contact list = nagg doesn't know this
          // account's graph — fall through so Primal/relay can try (answering
          // an empty follow set here would blank the seed).
          const hasContacts = envelope.events.some((e) => e.kind === 3);
          if (!hasContacts) {
            nostrLog.debug('nostr.nagg.socialGraph.empty');
            return unsupported();
          }
          const graph = socialGraphFromEvents(request.pubkey, envelope.events);
          return answered({ ...graph, profiles: profileInfoMapFromEnvelope(envelope) });
        },
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
      nostrLog.debug('nostr.nagg.dmEnvelopes', { path: binding.path });
      const result = await client.rest<typeof NaggEnvelopeSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggEnvelopeSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return result.match<TierOutcome<DmEnvelopesBundle>>(
        (envelope) => answered(bundleFromDmEnvelope(envelope)),
        (error) => failed(error),
      );
    },

    async searchProfiles(request: SearchRequest): Promise<TierOutcome<ProfileSearchBundle>> {
      // Gold path: Vertex-pagerank-ranked profile search over the app-view.
      const binding = profileSearchAppView({ query: request.query, limit: request.limit });
      nostrLog.debug('nostr.nagg.searchProfiles', { path: binding.path, q: request.query.length });
      const result = await client.rest<typeof NaggProfilesEnvelopeSchema>({
        path: binding.path,
        method: binding.method ?? 'GET',
        searchParams: binding.searchParams,
        responseSchema: NaggProfilesEnvelopeSchema,
        operationName: binding.operationName,
        refresh: request.refresh,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      // 0 results is a valid "no match" — nagg is authoritative for profile
      // search, so we don't cascade to the relay floor on an empty answer.
      return result.match<TierOutcome<ProfileSearchBundle>>(
        (envelope) => answered({ hits: searchHitsFromEnvelope(envelope) }),
        (error) => failed(error),
      );
    },
  };
}

// Map a FeedSpec to the right app-view binding: ranked specs POST the ranked
// recipe; chronological specs GET the follows / user feed routes. All return the
// canonical NaggFeedPage, so the tier bridges them identically.
function feedBindingForSpec(request: FeedPageRequest) {
  const until = request.cursor?.createdAt;
  const limit = request.limit;
  const offset = request.offset;
  const maxContentLength = request.maxContentLength;
  const spec = request.spec;
  switch (spec.kind) {
    // The ranked pools are OFFSET-paged: rank order is not chronological, and
    // the for-you feature path ignores a reference `until` entirely — paging it
    // by time re-serves page one verbatim (and on the live path it warps the
    // engagement window instead of advancing the page). The time cursor stays
    // out of the ranked bindings.
    case 'for-you':
      return rankedFeedAppView(
        forYouRankedEventsInput({ viewerPubkey: spec.viewerPubkey, limit, offset, maxContentLength }),
      );
    case 'following-popular':
      return rankedFeedAppView(
        followingPopularRankedEventsInput({ viewerPubkey: spec.viewerPubkey, limit, offset, maxContentLength }),
      );
    case 'following-recent':
      return followsFeedAppView({ pubkeys: spec.authors, viewer: spec.viewerPubkey, until, limit, maxContentLength });
    case 'user':
      return userFeedAppView({ pubkey: spec.pubkey, until, limit });
  }
}
