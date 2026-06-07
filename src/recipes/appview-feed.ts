// REST app-view bindings for the feed / ranked / thread / notifications / stats
// views. Each binding describes how a `transport:'appview'` request reaches the
// dedicated nagg REST route. nagg's app-view now emits the SAME canonical shape
// the GraphQL path converges on, so the bindings carry no `normalize` step — the
// raw REST body is parsed directly by the request's `dataSchema` (the same schema
// the GraphQL `graphqlToData`-distilled output parses with).
//
// The canonical shape for feed/ranked is `NaggFeedPage` (see `src/map/feed.ts`):
// a list of feed items plus `metrics`/`profiles`/`quoted` side maps. The REST
// `FeedResponse` carries exactly that, and the rich GraphQL node-with-aggregates
// selection is distilled to the same shape by `graphqlNodesToNaggPage` — so both
// transports produce an identical `NaggFeedPage`.

import type { NaggAppViewBinding } from '../transport';
import type { RankedEventsInput } from './feed';

// ---------------------------------------------------------------------------
// 1. Ranked feed — POST /nostr/feed/ranked
// ---------------------------------------------------------------------------

/**
 * App-view binding for the ranked feed (`rankedEvents` GraphQL counterpart):
 * POSTs the SAME ranked input map the `forYouRankedEventsInput` /
 * `followingPopularRankedEventsInput` recipes build as a JSON body to
 * `/nostr/feed/ranked`. The server returns a canonical `FeedResponse`
 * (`NaggFeedPage`) with ranking order preserved verbatim.
 */
export function rankedFeedAppView(input: RankedEventsInput): NaggAppViewBinding {
  return {
    path: '/nostr/feed/ranked',
    method: 'POST',
    operationName: 'RankedFeed',
    body: input,
  };
}

// ---------------------------------------------------------------------------
// 2. Follows feed — GET /nostr/feed   /   User feed — GET /nostr/feed/user
// ---------------------------------------------------------------------------

export type FollowsFeedAppViewOptions = {
  /** Authors whose notes make up the feed. Falls back to the server viewer when omitted. */
  pubkeys?: readonly string[];
  until?: number;
  limit?: number;
  offset?: number;
};

/**
 * App-view binding for the following-recent feed (the `events` query
 * counterpart): GET `/nostr/feed` with an authors CSV. The server returns a
 * canonical `FeedResponse` (`NaggFeedPage`).
 */
export function followsFeedAppView(options: FollowsFeedAppViewOptions = {}): NaggAppViewBinding {
  const pubkeys = (options.pubkeys ?? []).filter((value) => value.length > 0);
  return {
    path: '/nostr/feed',
    method: 'GET',
    operationName: 'FollowsFeed',
    searchParams: {
      ...(pubkeys.length > 0 ? { pubkeys: pubkeys.join(',') } : {}),
      ...(options.until ? { until: options.until } : {}),
      limit: options.limit ?? 30,
      ...(options.offset ? { offset: options.offset } : {}),
    },
  };
}

export type UserFeedAppViewOptions = {
  /** Author whose notes make up the feed. Falls back to the server viewer when omitted. */
  pubkey?: string;
  until?: number;
  limit?: number;
  offset?: number;
};

/**
 * App-view binding for a single-author profile feed (the `events` query
 * counterpart): GET `/nostr/feed/user`. The server returns a canonical
 * `FeedResponse` (`NaggFeedPage`).
 */
export function userFeedAppView(options: UserFeedAppViewOptions = {}): NaggAppViewBinding {
  return {
    path: '/nostr/feed/user',
    method: 'GET',
    operationName: 'UserFeed',
    searchParams: {
      ...(options.pubkey ? { pubkey: options.pubkey } : {}),
      ...(options.until ? { until: options.until } : {}),
      limit: options.limit ?? 50,
      ...(options.offset ? { offset: options.offset } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Thread — GET /nostr/thread
// ---------------------------------------------------------------------------

export type ThreadAppViewOptions = {
  /** Root/anchor event id (hex). */
  id: string;
  /** Max events to return (the REST `limit`; aliases the recipe's "depth"). */
  limit?: number;
};

/**
 * App-view binding for the thread view: GET `/nostr/thread`. The server returns
 * the canonical `ThreadResponse` (`NaggThread`) — the root event plus its ordered
 * descendants, with the same `metrics`/`profiles`/`quoted` hydration the feed uses.
 */
export function threadAppView(options: ThreadAppViewOptions): NaggAppViewBinding {
  return {
    path: '/nostr/thread',
    method: 'GET',
    operationName: 'Thread',
    searchParams: {
      id: options.id,
      ...(options.limit ? { limit: options.limit } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Notifications — GET /nostr/notifications
// ---------------------------------------------------------------------------

export type NotificationsAppViewInput = {
  pubkey: string;
  tab?: 'ALL' | 'MENTIONS';
  policy?: 'RELAXED' | 'MODERATE' | 'STRICT';
  replyScope?: 'DIRECT' | 'THREAD';
  since?: number;
  until?: number;
  limit?: number;
};

/**
 * App-view binding for notifications: GET `/nostr/notifications`. The server
 * returns the canonical `NotificationsResponse` (`NaggNotificationsPage`): a
 * `{ notifications: { nodes, pageInfo } }` connection (each node = `{ event,
 * reason, actorVertexScore }`) with the feed's `metrics`/`profiles`/`quoted`
 * hydration side maps alongside. The server now synthesises `pageInfo`
 * (`endCursor`/`hasNextPage`) itself, matching the GraphQL connection shape.
 */
export function notificationsAppView(input: NotificationsAppViewInput): NaggAppViewBinding {
  return {
    path: '/nostr/notifications',
    method: 'GET',
    operationName: 'Notifications',
    searchParams: {
      pubkey: input.pubkey,
      tab: input.tab ?? 'ALL',
      policy: input.policy ?? 'STRICT',
      replyScope: input.replyScope ?? 'THREAD',
      ...(input.since ? { since: input.since } : {}),
      ...(input.until ? { until: input.until } : {}),
      limit: input.limit ?? 50,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Note stats — POST /nostr/notes/stats
// ---------------------------------------------------------------------------

/**
 * App-view binding for per-note engagement stats (the per-node aggregates a feed
 * GraphQL query embeds, distilled by `metricsFromGraphqlNode`): POSTs the id
 * list to `/nostr/notes/stats`. The server returns the canonical
 * `map[string]NoteStats` (`NaggNoteStats`) keyed by event id.
 *
 * Note: nagg registers this route for POST only (the request carries an `ids`
 * JSON body, since a CSV id list can exceed URL length limits).
 */
export function noteStatsAppView(ids: readonly string[]): NaggAppViewBinding {
  const normalizedIds = ids.filter((id) => id.length > 0);
  return {
    path: '/nostr/notes/stats',
    method: 'POST',
    operationName: 'NoteStats',
    body: { ids: normalizedIds },
  };
}
