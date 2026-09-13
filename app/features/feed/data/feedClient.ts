import type { RequestControls as WalletRequestControls } from 'wallet';
import type { NostrCursor, NostrTier } from '@sovranbitcoin/schemas';

import type {
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import type { ThreadStructure } from '@/features/feed/lib/buildThreadStructure';

/**
 * Wallet's request controls plus the read-lifecycle correlation id
 * (`shared/lib/read/readLog.ts`), forwarded to the facade so `nostr.read.*` and
 * `nostr.tier.*` events join the caller's `read.<surface>.*` events.
 */
export type RequestControls = WalletRequestControls & { readId?: string };

/**
 * How a read resolved, distinct from what it returned (SYSTEM.md F06): an
 * empty page from a healthy source and an empty page because every tier was
 * exhausted must render differently. Absent means `ok`.
 */
export type ReadStatusMeta = {
  status: 'ok' | 'unavailable' | 'disabled';
  readId?: string;
  /** Tiers that contributed rows. */
  sources: NostrTier[];
  /** `tier=outcome` trail when tiers were exhausted. */
  attempts: string[];
  /** Some tier failed (even if another answered). */
  degraded: boolean;
};

export function readUnavailable(
  attempts: readonly { tier: NostrTier; outcome: string }[],
  readId?: string
): ReadStatusMeta {
  return {
    status: 'unavailable',
    ...(readId ? { readId } : {}),
    sources: [],
    attempts: attempts.map((a) => `${a.tier}=${a.outcome}`),
    degraded: true,
  };
}

export const READ_DISABLED: ReadStatusMeta = {
  status: 'disabled',
  sources: [],
  attempts: [],
  degraded: false,
};

/** `unavailable` with nothing retained on screen → the screen's error state; otherwise keep rows. */
export function readIsUnavailable(read: ReadStatusMeta | undefined): boolean {
  return read?.status === 'unavailable' || read?.status === 'disabled';
}

export type FeedParseResult = {
  orderedFeedItems: FeedItem[];
  metricsMap: Map<string, NoteMetrics>;
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
  paginationUntil: number;
  paginationOffset: number;
  paginationCursor: NostrCursor;
  hasMore: boolean | undefined;
  retryAfterMs?: number;
  sources?: NostrTier[];
  showingRecent?: boolean;
  /** Absent = ok. See `ReadStatusMeta`. */
  read?: ReadStatusMeta;
};

export type FeedEnrichmentUpdates = {
  quotedEvents?: Map<string, FeedEvent>;
  metrics?: Map<string, NoteMetrics>;
  profiles?: Map<string, ProfileInfo>;
};

export type FeedPageRequest = RequestControls & {
  spec: string;
  loadMore?: boolean;
  seen?: Iterable<string>;
  userPubkey?: string;
  limit?: number;
  cursor?: NostrCursor;
  until?: number;
  offset?: number;
  refresh?: boolean;
};

export type UserFeedPageRequest = RequestControls & {
  pubkey: string;
  authorName?: string;
  authorPicture?: string;
  limit?: number;
  cursor?: NostrCursor;
  until?: number;
  offset?: number;
  refresh?: boolean;
};

export type PostsByPubkeysRequest = RequestControls & {
  pubkeys: string[];
  limit?: number;
  cursor?: NostrCursor;
  until?: number;
  offset?: number;
  refresh?: boolean;
};

export type FeedEnrichmentRequest = RequestControls & {
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
  refresh?: boolean;
};

export type FeedNotificationPolicy = 'RELAXED' | 'MODERATE' | 'STRICT' | 'FOLLOWS';
export type FeedNotificationReplyScope = 'DIRECT' | 'THREAD';
export type FeedNotificationTab = 'ALL' | 'MENTIONS';

export type FeedNotificationsRequest = RequestControls & {
  viewerPubkey: string;
  tab?: FeedNotificationTab;
  policy?: FeedNotificationPolicy;
  replyScope?: FeedNotificationReplyScope;
  since?: number;
  until?: number;
  limit?: number;
  refresh?: boolean;
  /** Group follow/repost/reaction/zap server-side (default true). Set false for the raw list. */
  grouped?: boolean;
  /**
   * The viewer's own recent event ids (from ownContentStore). Powers the relay
   * floor's `#e`/`#q` backstop and flips its reply/engagement classification
   * from fail-open to fail-closed. Ignored by the server tiers.
   */
  ownEventIds?: string[];
};

/** One sampled participant of a grouped notification (for the avatar cluster). */
export type FeedNotificationActor = {
  pubkey: string;
  eventId: string;
  createdAt: number;
  actorVertexScore?: number;
};

export type FeedNotification = {
  event: FeedEvent;
  targetEvent?: FeedEvent;
  targetEventId?: string;
  reason: string;
  actorVertexScore: number;
  /** Server grouping metadata: present (with type 'group') when many notifications collapsed. */
  type?: 'single' | 'group';
  total?: number;
  totalCapped?: boolean;
  sampleActors?: FeedNotificationActor[];
};

export type FeedNotificationsResult = {
  notifications: FeedNotification[];
  profilesMap: Map<string, ProfileInfo>;
  metricsMap: Map<string, NoteMetrics>;
  quotedEventsMap: Map<string, FeedEvent>;
  paginationUntil: number;
  /** Server's hasNextPage — grouping collapses item counts below the page size,
   *  so the count alone can't decide whether to keep paging. */
  hasNextPage: boolean;
  /** Absent = ok. See `ReadStatusMeta`. */
  read?: ReadStatusMeta;
};

export type ThreadSeedBuckets = {
  allEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  metrics: Map<string, NoteMetrics>;
  quotedEvents: Map<string, FeedEvent>;
  replyPreviewEventIds?: string[];
};

export type ThreadReplySort = 'relevant' | 'new' | 'likes' | 'zaps' | 'reposts';

export type ThreadRequest = RequestControls & {
  eventId: string;
  limit?: number;
  offset?: number;
  sort?: ThreadReplySort;
  viewerPubkey?: string;
  seed?: ThreadSeedBuckets;
};

export type ThreadResult = ThreadSeedBuckets & {
  thread: ThreadStructure;
  replyPageEventIds: string[];
  replyPageSize: number;
  loadedReplyCount: number;
  hasMoreReplies: boolean;
  /** Tier that served this page; null when every tier was exhausted. */
  tier: NostrTier | null;
  /** Absent = ok. See `ReadStatusMeta`. */
  read?: ReadStatusMeta;
  /** The source's full acknowledged reply-id set — the spam-audit diff baseline. */
  knownReplyIds: string[];
  /**
   * The COMPLETE ordered reply stack this fetch delivered (nagg: the full
   * server manifest; Primal/relay: the locally sorted set). replyPageEventIds
   * is a window into it; load-more widens the window from memory.
   */
  allSortedReplyIds?: string[];
  /**
   * nagg only: the server holds MORE ordered replies beyond this stack (fetch
   * cap exceeded). Once the stack is exhausted, load-more extends it over the
   * network from the stack's end.
   */
  serverHasMoreReplies?: boolean;
};

/**
 * The unified three-source notifications surface: nagg + Primal + relays
 * fetched concurrently, merged into one shift-free page stream. `subscribe`
 * fires on IN-PLACE row updates (count bumps, shape upgrades) and pool-count
 * changes — new rows only ever appear from firstPage/loadMore results.
 */
export type AppNotificationsSession = {
  firstPage(): Promise<FeedNotificationsResult>;
  loadMore(): Promise<FeedNotificationsResult>;
  snapshot(): FeedNotificationsResult;
  hasMore(): boolean;
  pendingCount(): number;
  subscribe(listener: () => void): () => void;
  close(): void;
};

export interface FeedClient {
  getFeed(request: FeedPageRequest): Promise<FeedParseResult>;
  getUserFeed(request: UserFeedPageRequest): Promise<FeedParseResult>;
  /** Recent posts authored by an explicit set of pubkeys (search "Posts" tab). */
  getPostsByPubkeys(request: PostsByPubkeysRequest): Promise<FeedParseResult>;
  enrich(request: FeedEnrichmentRequest): Promise<FeedEnrichmentUpdates>;
  getNotifications(request: FeedNotificationsRequest): Promise<FeedNotificationsResult>;
  /**
   * Open the concurrent notifications session; null when the tab is
   * client-only, the facade layer is unavailable, or the client has no
   * session support (legacy transport) — callers fall back to
   * getNotifications.
   */
  openNotificationsSession?(request: FeedNotificationsRequest): AppNotificationsSession | null;
  getThread(request: ThreadRequest): Promise<ThreadResult>;
  dispose?(): void;
}

export function emptyFeedParseResult(read?: ReadStatusMeta): FeedParseResult {
  return {
    orderedFeedItems: [] as FeedItem[],
    metricsMap: new Map(),
    profilesMap: new Map(),
    quotedEventsMap: new Map(),
    missingQuotedIds: [],
    missingProfilePubkeys: [],
    paginationUntil: 0,
    paginationOffset: 0,
    paginationCursor: null,
    hasMore: false,
    ...(read ? { read } : {}),
  };
}
