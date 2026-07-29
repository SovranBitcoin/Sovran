// REST app-view bindings for the feed / ranked / thread / notifications /
// aggregates views. Each binding describes how a request reaches the dedicated
// nagg REST route. nagg v2 answers EVERY one of these with the generic envelope
// (`{ order, orderBy, events, aggregates, cursor? }`) — parse with
// `NaggEnvelopeSchema` (or the route's extension) and reconstruct the canonical
// facade shapes via `src/envelope.ts` (`feedPageFromEnvelope`,
// `threadFromEnvelope`, `notificationsPageFromEnvelope`, …).

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
  /** Viewer anchor: nagg expands to the viewer's latest kind-3 references. */
  viewer?: string;
  /** Authors whose notes make up the feed. Falls back to the server viewer when omitted. */
  pubkeys?: readonly string[];
  until?: number;
  limit?: number;
  offset?: number;
  maxContentLength?: number;
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
      // Explicit authors win; otherwise anchor on the viewer and nagg expands
      // to the authors the viewer's latest kind-3 references (server-side —
      // a follow list does not fit in a GET URL).
      ...(pubkeys.length > 0
        ? { pubkeys: pubkeys.join(',') }
        : options.viewer
          ? { viewer: options.viewer }
          : {}),
      ...(options.until ? { until: options.until } : {}),
      limit: options.limit ?? 30,
      ...(options.offset ? { offset: options.offset } : {}),
      ...(options.maxContentLength ? { maxContentLength: options.maxContentLength } : {}),
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
  /** Max events to fetch (the REST `limit`; aliases the recipe's "depth"). */
  limit?: number;
  /**
   * Reply render order: `new` (default, chronological/rank descendants),
   * `ranked` (engagement), or `relevant` (viewer-specific merge computed
   * server-side from the author chain + followed-tail + ranked replies).
   */
  sort?: 'new' | 'ranked' | 'relevant';
  /** Viewer pubkey — required for the `relevant` followed-reply tier. */
  viewer?: string;
  /** Reply-page offset + size for the ordering manifest (relevant/ranked). */
  offset?: number;
  replyLimit?: number;
  /** Candidate-pool sizes for the relevance merge. */
  candidateLimit?: number;
  rankedLimit?: number;
};

/**
 * App-view binding for the thread view: GET `/nostr/thread`. The server returns
 * the canonical `ThreadResponse` (`NaggThread`) — the root event plus its
 * descendants and a server-authoritative reply ordering. `sort=relevant`
 * reproduces the viewer-specific reply merge server-side (replacing the old
 * client-side GraphQL nested-resolver merge).
 */
export function threadAppView(options: ThreadAppViewOptions): NaggAppViewBinding {
  return {
    path: '/nostr/thread',
    method: 'GET',
    operationName: 'Thread',
    searchParams: {
      id: options.id,
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.sort && options.sort !== 'new' ? { sort: options.sort } : {}),
      ...(options.viewer ? { viewer: options.viewer } : {}),
      ...(options.offset ? { offset: options.offset } : {}),
      ...(options.replyLimit ? { replyLimit: options.replyLimit } : {}),
      ...(options.candidateLimit ? { candidateLimit: options.candidateLimit } : {}),
      ...(options.rankedLimit ? { rankedLimit: options.rankedLimit } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Notifications — GET /nostr/notifications
// ---------------------------------------------------------------------------

export type NotificationsAppViewInput = {
  pubkey: string;
  tab?: 'ALL' | 'MENTIONS';
  policy?: 'RELAXED' | 'MODERATE' | 'STRICT' | 'FOLLOWS';
  replyScope?: 'DIRECT' | 'THREAD';
  since?: number;
  until?: number;
  limit?: number;
  /**
   * Group follow/repost/reaction/zap items server-side (default true). Pass
   * false to read the raw ungrouped list (the followers-detail screen does).
   */
  grouped?: boolean;
};

/**
 * App-view binding for notifications: GET `/nostr/notifications`. v2 returns
 * the generic envelope EXTENDED with `entries` (`{ id, kind, actor, target?,
 * total?, totalCapped?, actors? }`) and `hasNext`. There are NO reason strings
 * anymore — the client derives follow/repost/reaction/zap/reply/quote/mention
 * from the entry kind + the embedded event's tags (`deriveNotificationReason`).
 * Parse with `NaggNotificationsEnvelopeSchema`, reconstruct via
 * `notificationsPageFromEnvelope`.
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
      ...(input.grouped === false ? { grouped: 'false' } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Event aggregates — POST /nostr/events/aggregates
// ---------------------------------------------------------------------------

/**
 * App-view binding for per-event engagement aggregates. v2 REPLACED
 * `POST /nostr/notes/stats`: POST the id list to `/nostr/events/aggregates` and
 * the server returns an envelope whose `aggregates` map carries the rule values
 * (`order`/`events` stay empty). Reconstruct the friendly per-id stats map with
 * `noteStatsFromEnvelope` (zero values are omitted server-side and default to 0
 * there).
 *
 * POST only — an `ids` CSV can exceed URL length limits.
 */
export function eventsAggregatesAppView(ids: readonly string[]): NaggAppViewBinding {
  const normalizedIds = ids.filter((id) => id.length > 0);
  return {
    path: '/nostr/events/aggregates',
    method: 'POST',
    operationName: 'EventsAggregates',
    body: { ids: normalizedIds },
  };
}
