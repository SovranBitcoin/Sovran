import type {
  NoteStatsMap,
  OrderingManifest,
  NostrCursor,
  NostrTier,
} from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggNoteMetrics, NaggProfileInfo } from '../map/feed';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';
import { statsFromMetrics } from './feed';

// ---------------------------------------------------------------------------
// Notifications surface
//
// "12 people liked your post" needs server aggregation, so a node may be a
// collapsed `group` (with a total + sample actors) or a `single`. The facade
// carries a `grouped` flag that degrades to flat on the relay floor. Same shape
// language as feed/thread: an unordered bundle keyed by a stable notification
// key + a manifest the facade renders by, so the list never reshuffles.
// ---------------------------------------------------------------------------

export type NotificationTab = 'ALL' | 'MENTIONS';
export type NotificationPolicy = 'RELAXED' | 'MODERATE' | 'STRICT' | 'FOLLOWS';
export type NotificationReplyScope = 'DIRECT' | 'THREAD';

export type NotificationsRequest = RequestControls & {
  viewerPubkey: string;
  tab?: NotificationTab;
  policy?: NotificationPolicy;
  replyScope?: NotificationReplyScope;
  /** Group follow/repost/reaction/zap server-side (default true). */
  grouped?: boolean;
  since?: number;
  cursor?: NostrCursor;
  limit?: number;
  refresh?: boolean;
  /**
   * The viewer's own recent event ids, for the relay floor's `#e`/`#q` backstop
   * and the fail-closed "references an event I own" gate (clients omit `#p` on
   * replies, so this is load-bearing there). Ignored by the server tiers.
   */
  ownEventIds?: string[];
};

export type NotificationActor = {
  pubkey: string;
  eventId: string;
  createdAt: number;
  actorVertexScore?: number;
};

export type NotificationItem = {
  type?: 'single' | 'group';
  event: NaggFeedEvent;
  reason: string;
  actorVertexScore: number;
  total?: number;
  totalCapped?: boolean;
  sampleActors?: NotificationActor[];
  /** passthrough fields: targetEventId, targetEvent. */
  [key: string]: unknown;
};

export type NotificationsSource = {
  notifications: {
    nodes: NotificationItem[];
    pageInfo?: { endCursor?: unknown; hasNextPage?: boolean };
  };
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
};

export type NotificationsBundle = {
  itemsById: Map<string, NotificationItem>;
  manifest: OrderingManifest;
  grouped: boolean;
  stats: NoteStatsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
};

export type ResolvedNotifications = {
  tier: NostrTier;
  notifications: NotificationItem[];
  grouped: boolean;
  stats: NoteStatsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
  missingIds: string[];
};

export interface NotificationsTier {
  readonly tier: NostrTier;
  notifications(request: NotificationsRequest): Promise<TierOutcome<NotificationsBundle>>;
}

/** Stable per-notification key: reason + its target (so a group collapses, singles stay distinct). */
export function notificationKey(node: NotificationItem): string {
  const target = typeof node['targetEventId'] === 'string' ? (node['targetEventId'] as string) : node.event.id;
  return `${node.reason}:${target}`;
}

export function bundleFromNotifications(source: NotificationsSource, grouped: boolean): NotificationsBundle {
  const itemsById = new Map<string, NotificationItem>();
  const elements: string[] = [];
  for (const node of source.notifications.nodes) {
    let key = notificationKey(node);
    // Guard against a (rare) key collision within one page so neither is dropped.
    if (itemsById.has(key)) key = `${key}#${elements.length}`;
    itemsById.set(key, node);
    elements.push(key);
  }

  const lastKey = elements[elements.length - 1];
  const lastNode = lastKey ? itemsById.get(lastKey) : undefined;
  const cursor: NostrCursor = lastNode
    ? { createdAt: lastNode.event.created_at, id: lastNode.event.id }
    : null;

  return {
    itemsById,
    manifest: { orderBy: 'created_at', elements },
    grouped,
    stats: statsFromMetrics(source.metrics),
    profiles: source.profiles,
    quoted: source.quoted,
    cursor,
  };
}
