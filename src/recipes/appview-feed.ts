// REST app-view bindings for the feed / ranked / thread / notifications / stats
// views. Each binding describes how a `transport:'appview'` request reaches the
// dedicated nagg REST route and how its server-shaped JSON is normalized back
// into the SAME canonical shape the GraphQL path converges on — so a consumer
// can flip the transport transparently and feed the result into the same parser.
//
// The canonical shape for feed/ranked/thread is `NaggFeedPage` (see
// `src/map/feed.ts`): a list of feed items plus `metrics`/`profiles`/`quoted`
// side maps. The REST `FeedResponse` already carries exactly that data, so the
// mapping is essentially a passthrough with light field normalization. The raw
// rich GraphQL node-with-aggregates selection is distilled to the same shape by
// `graphqlNodesToNaggPage`, so both transports produce an identical
// `NaggFeedPage`.

import type { NaggAppViewBinding } from '../transport';
import type { RankedEventsInput } from './feed';

// ---------------------------------------------------------------------------
// Raw REST shapes (mirroring nagg's Go structs in internal/appview/handler.go).
// ---------------------------------------------------------------------------

type RestFeedEvent = {
  id?: unknown;
  kind?: unknown;
  pubkey?: unknown;
  content?: unknown;
  tags?: unknown;
  created_at?: unknown;
};

type RestFeedItem = {
  type?: unknown;
  event?: RestFeedEvent | null;
  repostEvent?: RestFeedEvent | null;
  originalEvent?: RestFeedEvent | null;
  originalEventId?: unknown;
  rootEvent?: RestFeedEvent | null;
  rootEventId?: unknown;
};

type RestNoteStats = {
  likeCount?: unknown;
  repostCount?: unknown;
  replyCount?: unknown;
  satsZapped?: unknown;
};

type RestProfileInfo = {
  name?: unknown;
  picture?: unknown;
};

type RestFeedResponse = {
  items?: unknown;
  metrics?: Record<string, RestNoteStats>;
  profiles?: Record<string, RestProfileInfo>;
  quoted?: Record<string, RestFeedEvent>;
  paginationUntil?: unknown;
  paginationOffset?: unknown;
};

type RestNotificationRow = {
  event?: RestFeedEvent | null;
  reason?: unknown;
  actorVertexScore?: unknown;
};

type RestNotificationsResponse = {
  notifications?: unknown;
  metrics?: Record<string, RestNoteStats>;
  profiles?: Record<string, RestProfileInfo>;
  quoted?: Record<string, RestFeedEvent>;
  paginationUntil?: unknown;
};

type RestThreadResponse = {
  root?: RestFeedEvent | null;
  events?: unknown;
  metrics?: Record<string, RestNoteStats>;
  profiles?: Record<string, RestProfileInfo>;
  quoted?: Record<string, RestFeedEvent>;
};

// ---------------------------------------------------------------------------
// Field-level normalizers.
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeFeedEvent(raw: RestFeedEvent | null | undefined): {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
} | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (typeof raw.id !== 'string' || typeof raw.pubkey !== 'string') return undefined;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((tag): tag is unknown[] => Array.isArray(tag))
        .map((tag) => tag.map((value) => toString(value)))
    : [];
  return {
    id: raw.id,
    kind: toNumber(raw.kind),
    pubkey: raw.pubkey,
    content: toString(raw.content),
    tags,
    created_at: toNumber(raw.created_at),
  };
}

function normalizeMetrics(raw: RestNoteStats | null | undefined): {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  satsZapped: number;
} {
  const stats = (raw ?? {}) as RestNoteStats;
  return {
    likeCount: toNumber(stats.likeCount),
    repostCount: toNumber(stats.repostCount),
    replyCount: toNumber(stats.replyCount),
    satsZapped: toNumber(stats.satsZapped),
  };
}

function normalizeMetricsMap(
  raw: Record<string, RestNoteStats> | undefined
): Record<string, ReturnType<typeof normalizeMetrics>> {
  const out: Record<string, ReturnType<typeof normalizeMetrics>> = {};
  for (const [id, stats] of Object.entries(raw ?? {})) {
    out[id] = normalizeMetrics(stats);
  }
  return out;
}

function normalizeProfilesMap(
  raw: Record<string, RestProfileInfo> | undefined
): Record<string, { name: string; picture?: string }> {
  const out: Record<string, { name: string; picture?: string }> = {};
  for (const [pubkey, profile] of Object.entries(raw ?? {})) {
    const name = toString(profile?.name);
    const picture = typeof profile?.picture === 'string' && profile.picture.length > 0 ? profile.picture : undefined;
    out[pubkey] = { name, ...(picture ? { picture } : {}) };
  }
  return out;
}

function normalizeQuotedMap(
  raw: Record<string, RestFeedEvent> | undefined
): Record<string, ReturnType<typeof normalizeFeedEvent>> {
  const out: Record<string, ReturnType<typeof normalizeFeedEvent>> = {};
  for (const [id, event] of Object.entries(raw ?? {})) {
    const normalized = normalizeFeedEvent(event);
    if (normalized) out[id] = normalized;
  }
  return out;
}

function normalizeFeedItem(raw: RestFeedItem):
  | {
      type: 'note';
      event: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
      rootEvent?: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
      rootEventId?: string;
    }
  | {
      type: 'repost';
      repostEvent: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
      originalEvent?: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
      originalEventId?: string;
      rootEvent?: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
      rootEventId?: string;
      reposters: Array<{ pubkey: string; event: NonNullable<ReturnType<typeof normalizeFeedEvent>> }>;
    }
  | undefined {
  const rootEvent = normalizeFeedEvent(raw.rootEvent);
  const rootEventId =
    typeof raw.rootEventId === 'string' && raw.rootEventId.length > 0
      ? raw.rootEventId
      : rootEvent?.id;

  if (raw.type === 'repost') {
    const repostEvent = normalizeFeedEvent(raw.repostEvent);
    if (!repostEvent) return undefined;
    const originalEvent = normalizeFeedEvent(raw.originalEvent);
    const originalEventId =
      typeof raw.originalEventId === 'string' && raw.originalEventId.length > 0
        ? raw.originalEventId
        : originalEvent?.id;
    return {
      type: 'repost',
      repostEvent,
      ...(originalEvent ? { originalEvent } : {}),
      ...(originalEventId ? { originalEventId } : {}),
      ...(rootEvent ? { rootEvent } : {}),
      ...(rootEventId ? { rootEventId } : {}),
      reposters: [{ pubkey: repostEvent.pubkey, event: repostEvent }],
    };
  }

  const event = normalizeFeedEvent(raw.event);
  if (!event) return undefined;
  return {
    type: 'note',
    event,
    ...(rootEvent ? { rootEvent } : {}),
    ...(rootEventId ? { rootEventId } : {}),
  };
}

// normalizeFeedResponse maps a REST `FeedResponse` into the canonical
// `NaggFeedPage` shape (`{ items, metrics, profiles, quoted, paginationUntil,
// paginationOffset }`) — the same shape `graphqlNodesToNaggPage` produces, ready
// for `mapNaggFeedPage`.
export function normalizeFeedResponse(raw: unknown): {
  items: Array<NonNullable<ReturnType<typeof normalizeFeedItem>>>;
  metrics: Record<string, ReturnType<typeof normalizeMetrics>>;
  profiles: Record<string, { name: string; picture?: string }>;
  quoted: Record<string, NonNullable<ReturnType<typeof normalizeFeedEvent>>>;
  paginationUntil: number;
  paginationOffset: number;
} {
  const body = (raw ?? {}) as RestFeedResponse;
  const rawItems = Array.isArray(body.items) ? (body.items as RestFeedItem[]) : [];
  const items = rawItems
    .map(normalizeFeedItem)
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  return {
    items,
    metrics: normalizeMetricsMap(body.metrics),
    profiles: normalizeProfilesMap(body.profiles),
    quoted: normalizeQuotedMap(body.quoted) as Record<
      string,
      NonNullable<ReturnType<typeof normalizeFeedEvent>>
    >,
    paginationUntil: toNumber(body.paginationUntil),
    paginationOffset: toNumber(body.paginationOffset),
  };
}

// ---------------------------------------------------------------------------
// 1. Ranked feed — POST /nostr/feed/ranked
// ---------------------------------------------------------------------------

/**
 * App-view binding for the ranked feed (`rankedEvents` GraphQL counterpart):
 * POSTs the SAME ranked input map the `forYouRankedEventsInput` /
 * `followingPopularRankedEventsInput` recipes build as a JSON body to
 * `/nostr/feed/ranked`, and normalizes the `FeedResponse` into the canonical
 * `NaggFeedPage` shape. Ranking order is preserved verbatim by the server.
 */
export function rankedFeedAppView(input: RankedEventsInput): NaggAppViewBinding {
  return {
    path: '/nostr/feed/ranked',
    method: 'POST',
    operationName: 'RankedFeed',
    body: input,
    normalize: normalizeFeedResponse,
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
 * counterpart): GET `/nostr/feed` with an authors CSV, normalizing the
 * `FeedResponse` into the canonical `NaggFeedPage` shape.
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
    normalize: normalizeFeedResponse,
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
 * counterpart): GET `/nostr/feed/user`, normalizing the `FeedResponse` into the
 * canonical `NaggFeedPage` shape.
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
    normalize: normalizeFeedResponse,
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
 * App-view binding for the thread view: GET `/nostr/thread`, normalizing the
 * `{ root, events, metrics, profiles, quoted }` payload into the canonical
 * thread shape — the root event plus its ordered descendants, all events
 * normalized to `NaggFeedEvent` and the same hydration side maps the feed uses.
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
    normalize: normalizeThreadResponse,
  };
}

export function normalizeThreadResponse(raw: unknown): {
  root: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
  events: Array<NonNullable<ReturnType<typeof normalizeFeedEvent>>>;
  metrics: Record<string, ReturnType<typeof normalizeMetrics>>;
  profiles: Record<string, { name: string; picture?: string }>;
  quoted: Record<string, NonNullable<ReturnType<typeof normalizeFeedEvent>>>;
} {
  const body = (raw ?? {}) as RestThreadResponse;
  const root = normalizeFeedEvent(body.root);
  const rawEvents = Array.isArray(body.events) ? (body.events as RestFeedEvent[]) : [];
  const events = rawEvents
    .map(normalizeFeedEvent)
    .filter((event): event is NonNullable<typeof event> => event !== undefined);
  return {
    root: root ?? { id: '', kind: 0, pubkey: '', content: '', tags: [], created_at: 0 },
    events,
    metrics: normalizeMetricsMap(body.metrics),
    profiles: normalizeProfilesMap(body.profiles),
    quoted: normalizeQuotedMap(body.quoted) as Record<
      string,
      NonNullable<ReturnType<typeof normalizeFeedEvent>>
    >,
  };
}

// ---------------------------------------------------------------------------
// 4. Notifications — GET /nostr/notifications
// ---------------------------------------------------------------------------

export type NotificationsAppViewInput = {
  viewer: string;
  tab?: 'ALL' | 'MENTIONS';
  policy?: 'RELAXED' | 'MODERATE' | 'STRICT';
  replyScope?: 'DIRECT' | 'THREAD';
  since?: number;
  until?: number;
  limit?: number;
};

/**
 * App-view binding for notifications: GET `/nostr/notifications`, normalizing the
 * `NotificationsResponse` into the canonical `{ notifications: { nodes,
 * pageInfo } }` connection shape (each node = `{ event, reason,
 * actorVertexScore }`), with the feed's `metrics`/`profiles`/`quoted` hydration
 * side maps carried alongside. `pageInfo.endCursor` is the server's
 * `paginationUntil` (the oldest event time in the page), and `hasNextPage` is
 * true when the page filled to `limit`.
 */
export function notificationsAppView(input: NotificationsAppViewInput): NaggAppViewBinding {
  const limit = input.limit ?? 50;
  return {
    path: '/nostr/notifications',
    method: 'GET',
    operationName: 'Notifications',
    searchParams: {
      viewer: input.viewer,
      tab: input.tab ?? 'ALL',
      policy: input.policy ?? 'STRICT',
      replyScope: input.replyScope ?? 'THREAD',
      ...(input.since ? { since: input.since } : {}),
      ...(input.until ? { until: input.until } : {}),
      limit,
    },
    normalize: (raw) => normalizeNotificationsResponse(raw, limit),
  };
}

export function normalizeNotificationsResponse(
  raw: unknown,
  limit?: number
): {
  notifications: {
    nodes: Array<{
      event: NonNullable<ReturnType<typeof normalizeFeedEvent>>;
      reason: string;
      actorVertexScore: number;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: number | null };
  };
  metrics: Record<string, ReturnType<typeof normalizeMetrics>>;
  profiles: Record<string, { name: string; picture?: string }>;
  quoted: Record<string, NonNullable<ReturnType<typeof normalizeFeedEvent>>>;
} {
  const body = (raw ?? {}) as RestNotificationsResponse;
  const rawRows = Array.isArray(body.notifications)
    ? (body.notifications as RestNotificationRow[])
    : [];
  const nodes = rawRows
    .map((row) => {
      const event = normalizeFeedEvent(row?.event);
      if (!event) return undefined;
      return {
        event,
        reason: toString(row?.reason),
        actorVertexScore: toNumber(row?.actorVertexScore),
      };
    })
    .filter((node): node is NonNullable<typeof node> => node !== undefined);

  const paginationUntil = toNumber(body.paginationUntil);
  const hasNextPage = typeof limit === 'number' && limit > 0 ? nodes.length >= limit : false;
  return {
    notifications: {
      nodes,
      pageInfo: {
        hasNextPage,
        endCursor: paginationUntil > 0 ? paginationUntil : null,
      },
    },
    metrics: normalizeMetricsMap(body.metrics),
    profiles: normalizeProfilesMap(body.profiles),
    quoted: normalizeQuotedMap(body.quoted) as Record<
      string,
      NonNullable<ReturnType<typeof normalizeFeedEvent>>
    >,
  };
}

// ---------------------------------------------------------------------------
// 5. Note stats — POST /nostr/notes/stats
// ---------------------------------------------------------------------------

/**
 * App-view binding for per-note engagement stats (the per-node aggregates a feed
 * GraphQL query embeds, distilled by `metricsFromGraphqlNode`): POSTs the id
 * list to `/nostr/notes/stats` and normalizes the `map[string]NoteStats` body
 * into the canonical `Record<string, NaggNoteMetrics>` shape keyed by event id.
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
    normalize: normalizeNoteStatsResponse,
  };
}

export function normalizeNoteStatsResponse(
  raw: unknown
): Record<string, ReturnType<typeof normalizeMetrics>> {
  const body = (raw ?? {}) as Record<string, RestNoteStats>;
  return normalizeMetricsMap(body);
}
