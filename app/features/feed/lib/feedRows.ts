import type { EngagementViewState } from '@/features/feed/hooks/useNostrEngagement';
import { getFeedItemRootContext } from '@/features/feed/lib/rootContext';
import { collectQuoteTagIds, parseContent, tryNpubEncode } from '../components/nostr/feedParse';
import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';

export type FeedRow = {
  key: string;
  item: FeedItem;
  rootEvent?: FeedEvent;
  metrics: NoteMetrics;
  engagement: EngagementViewState;
  rootMetrics?: NoteMetrics;
  rootEngagement?: EngagementViewState;
  profiles: Map<string, ProfileInfo>;
  quotedEvents: Map<string, FeedEvent>;
  reposterName?: string;
  reposterPubkey?: string;
  reposters?: { name: string; pubkey: string }[];
};

export const DEFAULT_ENGAGEMENT_STATE: EngagementViewState = Object.freeze({
  liked: false,
  reposted: false,
  replied: false,
  likePending: false,
  repostPending: false,
});

type BuildFeedRowsOptions = {
  items: FeedItem[];
  previousRows: FeedRow[];
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  getDisplayMetrics: (eventId: string) => NoteMetrics;
  getEngagementState: (eventId: string) => EngagementViewState;
  resolveReposter?: (item: Extract<FeedItem, { type: 'repost' }>) => {
    name: string;
    pubkey: string;
  };
};

export function buildFeedRows({
  items,
  previousRows,
  profilesMap,
  quotedEventsMap,
  getDisplayMetrics,
  getEngagementState,
  resolveReposter = defaultResolveReposter,
}: BuildFeedRowsOptions): FeedRow[] {
  const previousByKey = new Map(previousRows.map((row) => [row.key, row]));

  return items.map((item) => {
    const key = getFeedItemKey(item);
    const rootEvent = getFeedItemRootContext(item);
    const primaryEventId = getPrimaryEventId(item);
    const localMaps = buildRowLocalMaps(item, rootEvent, profilesMap, quotedEventsMap);
    const reposters = item.type === 'repost' ? resolveReposters(item, resolveReposter) : undefined;
    const reposter = reposters?.[0];
    const candidate: FeedRow = {
      key,
      item,
      rootEvent,
      metrics: getDisplayMetrics(primaryEventId),
      engagement: getEngagementState(primaryEventId),
      rootMetrics: rootEvent ? getDisplayMetrics(rootEvent.id) : undefined,
      rootEngagement: rootEvent ? getEngagementState(rootEvent.id) : undefined,
      profiles: localMaps.profiles,
      quotedEvents: localMaps.quotedEvents,
      reposterName: reposter?.name,
      reposterPubkey: reposter?.pubkey,
      reposters,
    };

    const previous = previousByKey.get(key);
    return previous && feedRowContentEqual(previous, candidate) ? previous : candidate;
  });
}

function getFeedItemKey(item: FeedItem): string {
  return item.type === 'note' ? item.event.id : item.originalEventId;
}

export function getFeedRowKey(row: FeedRow): string {
  return row.key;
}

export function getFeedRowItemType(row: FeedRow): string {
  const hasReplyPreview =
    row.item.type === 'note' && (row.item.replyPreviewEvents?.length ?? 0) > 0;
  return `${row.item.type}${row.rootEvent ? '-with-root' : ''}${
    hasReplyPreview ? '-with-preview' : ''
  }`;
}

/**
 * The distinct events a viewer can like, repost, or zap from a list of feed
 * items — the note itself, the reposted original, and any thread root shown
 * above it. Deduped by id so engagement is subscribed once per event.
 */
export function collectActionableEvents(items: FeedItem[]): FeedEvent[] {
  const map = new Map<string, FeedEvent>();
  for (const item of items) {
    if (item.rootEvent) {
      map.set(item.rootEvent.id, item.rootEvent);
    }
    if (item.type === 'note') {
      map.set(item.event.id, item.event);
    } else if (item.originalEvent) {
      map.set(item.originalEvent.id, item.originalEvent);
    }
  }
  return Array.from(map.values());
}

function getPrimaryEventId(item: FeedItem): string {
  return item.type === 'note' ? item.event.id : item.originalEventId;
}

function getDisplayEvents(item: FeedItem, rootEvent: FeedEvent | undefined): FeedEvent[] {
  const events: FeedEvent[] = [];
  if (rootEvent) events.push(rootEvent);
  if (item.type === 'note') {
    events.push(item.event);
    for (const replyPreviewEvent of item.replyPreviewEvents ?? []) {
      events.push(replyPreviewEvent);
    }
  } else {
    events.push(item.repostEvent);
    for (const reposter of item.reposters ?? []) events.push(reposter.event);
    if (item.originalEvent) events.push(item.originalEvent);
  }
  return events;
}

function buildRowLocalMaps(
  item: FeedItem,
  rootEvent: FeedEvent | undefined,
  profilesMap: Map<string, ProfileInfo>,
  quotedEventsMap: Map<string, FeedEvent>
): {
  profiles: Map<string, ProfileInfo>;
  quotedEvents: Map<string, FeedEvent>;
} {
  const profilePubkeys = new Set<string>();
  const quoteIds = new Set<string>();
  const displayEvents = getDisplayEvents(item, rootEvent);

  for (const event of displayEvents) {
    collectProfilePubkeys(event, profilePubkeys);
    collectQuotedEventIds(event, quoteIds);
  }

  const quotedEvents = new Map<string, FeedEvent>();
  for (const id of quoteIds) {
    const quoted = quotedEventsMap.get(id);
    if (!quoted) continue;
    quotedEvents.set(id, quoted);
    collectProfilePubkeys(quoted, profilePubkeys);
  }

  const profiles = new Map<string, ProfileInfo>();
  for (const pubkey of profilePubkeys) {
    const profile = profilesMap.get(pubkey);
    if (profile) profiles.set(pubkey, profile);
  }

  return { profiles, quotedEvents };
}

function collectProfilePubkeys(event: FeedEvent, out: Set<string>): void {
  out.add(event.pubkey);
  for (const segment of parseContent(event.content)) {
    if (segment.kind === 'npub' || segment.kind === 'nprofile') {
      out.add(segment.pubkey);
    }
  }
}

function collectQuotedEventIds(event: FeedEvent, out: Set<string>): void {
  for (const segment of parseContent(event.content)) {
    if (segment.kind === 'nevent' || segment.kind === 'note') {
      out.add(segment.eventId);
    }
  }
  for (const id of collectQuoteTagIds(event)) out.add(id);
}

function defaultResolveReposter(item: Extract<FeedItem, { type: 'repost' }>): {
  name: string;
  pubkey: string;
} {
  const pubkey = item.repostEvent.pubkey;
  return {
    name: `${tryNpubEncode(pubkey).slice(0, 12)}…`,
    pubkey,
  };
}

function resolveReposters(
  item: Extract<FeedItem, { type: 'repost' }>,
  resolveReposter: NonNullable<BuildFeedRowsOptions['resolveReposter']>
): { name: string; pubkey: string }[] {
  const reposterEvents =
    item.reposters && item.reposters.length > 0
      ? item.reposters.map((reposter) => reposter.event)
      : [item.repostEvent];
  return reposterEvents.map((repostEvent) => resolveReposter({ ...item, repostEvent }));
}

function feedRowContentEqual(previous: FeedRow, next: FeedRow): boolean {
  return (
    previous.item === next.item &&
    previous.rootEvent === next.rootEvent &&
    optionalMetricsEqual(previous.metrics, next.metrics) &&
    optionalMetricsEqual(previous.rootMetrics, next.rootMetrics) &&
    engagementEqual(previous.engagement, next.engagement) &&
    optionalEngagementEqual(previous.rootEngagement, next.rootEngagement) &&
    mapEntriesEqual(previous.profiles, next.profiles) &&
    mapEntriesEqual(previous.quotedEvents, next.quotedEvents) &&
    previous.reposterName === next.reposterName &&
    previous.reposterPubkey === next.reposterPubkey &&
    repostersEqual(previous.reposters, next.reposters)
  );
}

function repostersEqual(
  a: { name: string; pubkey: string }[] | undefined,
  b: { name: string; pubkey: string }[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((reposter, index) => {
    const other = b[index];
    return other?.name === reposter.name && other.pubkey === reposter.pubkey;
  });
}

function optionalMetricsEqual(a: NoteMetrics | undefined, b: NoteMetrics | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.likeCount === b.likeCount &&
    a.repostCount === b.repostCount &&
    a.replyCount === b.replyCount &&
    a.satsZapped === b.satsZapped
  );
}

function engagementEqual(a: EngagementViewState, b: EngagementViewState): boolean {
  return (
    a.liked === b.liked &&
    a.reposted === b.reposted &&
    a.replied === b.replied &&
    a.likePending === b.likePending &&
    a.repostPending === b.repostPending &&
    a.likePendingDirection === b.likePendingDirection &&
    a.repostPendingDirection === b.repostPendingDirection
  );
}

function optionalEngagementEqual(
  a: EngagementViewState | undefined,
  b: EngagementViewState | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return engagementEqual(a, b);
}

function mapEntriesEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}
