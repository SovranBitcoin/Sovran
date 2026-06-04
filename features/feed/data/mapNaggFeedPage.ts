import { collectReferencedIds, getFirstTagValue } from '@/features/feed/components/nostr/feedParse';
import type {
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import { DEFAULT_METRICS } from '@/features/feed/components/nostr/feedTypes';
import type { FeedParseResult } from './feedClient';
import type { NaggFeedResponseData } from './naggSchemas';

type MapNaggFeedPageOptions = {
  includeNote?: (event: FeedEvent) => boolean;
  includeRepost?: (event: FeedEvent) => boolean;
  extraProfile?: { pubkey: string; profile: ProfileInfo };
};

export function mapNaggFeedPage(
  page: NaggFeedResponseData,
  options: MapNaggFeedPageOptions = {}
): FeedParseResult {
  const metricsMap = new Map<string, NoteMetrics>(Object.entries(page.metrics));
  const profilesMap = new Map<string, ProfileInfo>(Object.entries(page.profiles));
  const quotedEventsMap = new Map<string, FeedEvent>(Object.entries(page.quoted));
  const { includeNote, includeRepost, extraProfile } = options;
  if (extraProfile) profilesMap.set(extraProfile.pubkey, extraProfile.profile);

  const orderedFeedItems: FeedItem[] = [];
  const contentSources: FeedEvent[] = [];

  for (const item of page.items) {
    if (item.type === 'note') {
      if (includeNote && !includeNote(item.event)) continue;
      const rootEvent = item.rootEvent ?? undefined;
      const rootEventId = item.rootEventId ?? rootEvent?.id;
      const replyPreviewEvents = item.replyPreviewEvents ?? [];
      orderedFeedItems.push({
        type: 'note',
        event: item.event,
        rootEvent,
        rootEventId,
        ...(replyPreviewEvents.length > 0 ? { replyPreviewEvents } : {}),
        timestamp: item.event.created_at || 0,
      });
      contentSources.push(item.event);
      if (rootEvent) contentSources.push(rootEvent);
      for (const replyPreviewEvent of replyPreviewEvents) contentSources.push(replyPreviewEvent);
      if (!metricsMap.has(item.event.id)) metricsMap.set(item.event.id, { ...DEFAULT_METRICS });
      if (rootEvent && !metricsMap.has(rootEvent.id)) {
        metricsMap.set(rootEvent.id, { ...DEFAULT_METRICS });
      }
      for (const replyPreviewEvent of replyPreviewEvents) {
        if (!metricsMap.has(replyPreviewEvent.id)) {
          metricsMap.set(replyPreviewEvent.id, { ...DEFAULT_METRICS });
        }
      }
      continue;
    }

    if (includeRepost && !includeRepost(item.repostEvent)) continue;
    const originalEvent = item.originalEvent ?? undefined;
    const originalEventId = item.originalEventId ?? getFirstTagValue(item.repostEvent, 'e');
    const rootEvent = item.rootEvent ?? undefined;
    const rootEventId = item.rootEventId ?? rootEvent?.id;
    if (!originalEventId) continue;

    orderedFeedItems.push({
      type: 'repost',
      repostEvent: item.repostEvent,
      originalEvent,
      originalEventId,
      rootEvent,
      rootEventId,
      timestamp: item.repostEvent.created_at || 0,
    });

    if (originalEvent) contentSources.push(originalEvent);
    if (rootEvent) contentSources.push(rootEvent);
    if (!metricsMap.has(originalEventId)) metricsMap.set(originalEventId, { ...DEFAULT_METRICS });
    if (rootEvent && !metricsMap.has(rootEvent.id)) {
      metricsMap.set(rootEvent.id, { ...DEFAULT_METRICS });
    }
  }

  const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
    collectReferencedIds(contentSources);
  const missingQuotedIds = referencedEventIds.filter((id) => !quotedEventsMap.has(id));

  const neededPubkeys = new Set(inlineMentionPubkeys);
  for (const ev of contentSources) neededPubkeys.add(ev.pubkey);
  for (const item of orderedFeedItems) {
    if (item.type === 'repost') neededPubkeys.add(item.repostEvent.pubkey);
  }
  for (const ev of quotedEventsMap.values()) neededPubkeys.add(ev.pubkey);
  const missingProfilePubkeys = Array.from(neededPubkeys).filter((pk) => !profilesMap.has(pk));

  return {
    orderedFeedItems,
    metricsMap,
    profilesMap,
    quotedEventsMap,
    missingQuotedIds,
    missingProfilePubkeys,
    paginationUntil: page.paginationUntil,
    paginationOffset: page.paginationOffset,
  };
}
