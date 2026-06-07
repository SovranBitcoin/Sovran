import type { RequestControls } from '@sovranbitcoin/colada';
import type {
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import type { ThreadStructure } from '@/features/feed/lib/buildThreadStructure';

export type FeedParseResult = {
  orderedFeedItems: FeedItem[];
  metricsMap: Map<string, NoteMetrics>;
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
  paginationUntil: number;
  paginationOffset: number;
};

export type FeedEnrichmentUpdates = {
  quotedEvents?: Map<string, FeedEvent>;
  metrics?: Map<string, NoteMetrics>;
  profiles?: Map<string, ProfileInfo>;
};

export type FeedPageRequest = RequestControls & {
  spec: string;
  userPubkey?: string;
  limit?: number;
  until?: number;
  offset?: number;
  refresh?: boolean;
};

export type UserFeedPageRequest = RequestControls & {
  pubkey: string;
  authorName?: string;
  authorPicture?: string;
  limit?: number;
  until?: number;
  offset?: number;
  refresh?: boolean;
};

export type PostsByPubkeysRequest = RequestControls & {
  pubkeys: string[];
  limit?: number;
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
};

export interface FeedClient {
  getFeed(request: FeedPageRequest): Promise<FeedParseResult>;
  getUserFeed(request: UserFeedPageRequest): Promise<FeedParseResult>;
  /** Recent posts authored by an explicit set of pubkeys (search "Posts" tab). */
  getPostsByPubkeys(request: PostsByPubkeysRequest): Promise<FeedParseResult>;
  enrich(request: FeedEnrichmentRequest): Promise<FeedEnrichmentUpdates>;
  getNotifications(request: FeedNotificationsRequest): Promise<FeedNotificationsResult>;
  getThread(request: ThreadRequest): Promise<ThreadResult>;
  dispose?(): void;
}

export function emptyFeedParseResult(): FeedParseResult {
  return {
    orderedFeedItems: [] as FeedItem[],
    metricsMap: new Map(),
    profilesMap: new Map(),
    quotedEventsMap: new Map(),
    missingQuotedIds: [],
    missingProfilePubkeys: [],
    paginationUntil: 0,
    paginationOffset: 0,
  };
}
