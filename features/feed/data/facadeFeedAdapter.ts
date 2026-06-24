import { facade } from '@sovranbitcoin/nagg-ts';

import { parseJson } from '../components/nostr/feedParse';
import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import type { FeedParseResult } from './feedClient';

// Pure shape bridge between the tier-selecting facade and the app's feed UI.
// Kept dependency-light (facade types + feed types only) so it's unit-testable
// without the facade-builder's React-Native chain.

/** Map the app's JSON feed spec to the facade FeedSpec (ranked home feeds only). */
export function mapAppSpecToFeedSpec(
  specJson: string,
  userPubkey?: string
): facade.FeedSpec | null {
  const parsed = parseJson<Record<string, unknown>>(specJson);
  if (parsed?.kind !== 'notes') return null;
  switch (parsed.id) {
    case 'for-you':
      return { kind: 'for-you', ...(userPubkey ? { viewerPubkey: userPubkey } : {}) };
    case 'following-popular':
      return userPubkey ? { kind: 'following-popular', viewerPubkey: userPubkey } : null;
    default:
      return null;
  }
}

/** Adapt the facade's ResolvedFeedPage to the app's FeedParseResult. */
export function resolvedFeedPageToParseResult(page: facade.ResolvedFeedPage): FeedParseResult {
  const orderedFeedItems = page.items.map(toAppFeedItem);

  const metricsMap = new Map<string, NoteMetrics>();
  for (const [id, s] of Object.entries(page.stats)) {
    metricsMap.set(id, {
      likeCount: s.likes,
      repostCount: s.reposts,
      replyCount: s.replies,
      satsZapped: s.satsZapped,
    });
  }

  const profilesMap = new Map<string, ProfileInfo>(
    Object.entries(page.profiles).map(([pk, p]) => [
      pk,
      { name: p.name, ...(p.picture ? { picture: p.picture } : {}) },
    ])
  );
  const quotedEventsMap = new Map<string, FeedEvent>(
    Object.entries(page.quoted) as [string, FeedEvent][]
  );

  // Gaps the existing enrichment path (delegated to the old client) can fill.
  const neededPubkeys = new Set<string>();
  const neededQuoteIds = new Set<string>();
  for (const item of orderedFeedItems) {
    const events = item.type === 'note' ? [item.event] : [item.repostEvent, item.originalEvent];
    for (const event of events) {
      if (!event) continue;
      neededPubkeys.add(event.pubkey);
      for (const tag of event.tags) {
        if (tag[0] === 'q' && tag[1]) neededQuoteIds.add(tag[1]);
      }
    }
  }

  return {
    orderedFeedItems,
    metricsMap,
    profilesMap,
    quotedEventsMap,
    missingQuotedIds: [...neededQuoteIds].filter((id) => !quotedEventsMap.has(id)),
    missingProfilePubkeys: [...neededPubkeys].filter((pk) => !profilesMap.has(pk)),
    paginationUntil: page.cursor?.createdAt ?? 0,
    paginationOffset: orderedFeedItems.length,
  };
}

function toAppFeedItem(item: facade.FeedItem): FeedItem {
  if (item.type === 'note') {
    return {
      type: 'note',
      event: item.event as FeedEvent,
      ...(item.rootEvent ? { rootEvent: item.rootEvent as FeedEvent } : {}),
      ...(item.rootEventId ? { rootEventId: item.rootEventId } : {}),
      ...(item.replyPreviewEvents
        ? { replyPreviewEvents: item.replyPreviewEvents as FeedEvent[] }
        : {}),
      timestamp: item.event.created_at ?? 0,
    };
  }
  return {
    type: 'repost',
    repostEvent: item.repostEvent as FeedEvent,
    originalEvent: (item.originalEvent ?? undefined) as FeedEvent | undefined,
    originalEventId: item.originalEventId ?? item.repostEvent.id,
    ...(item.rootEvent ? { rootEvent: item.rootEvent as FeedEvent } : {}),
    ...(item.rootEventId ? { rootEventId: item.rootEventId } : {}),
    ...(item.reposters
      ? { reposters: item.reposters as { pubkey: string; event: FeedEvent }[] }
      : {}),
    timestamp: item.repostEvent.created_at ?? 0,
  };
}
