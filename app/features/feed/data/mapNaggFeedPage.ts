import {
  mapNaggFeedPage as mapNaggFeedPageBase,
  type MapNaggFeedPageOptions as BaseMapNaggFeedPageOptions,
  type NaggFeedPage,
} from 'nostr/map';
import { collectReferencedIds } from '@/features/feed/components/nostr/feedParse';
import type { FeedEvent, ProfileInfo } from '@/features/feed/components/nostr/feedTypes';
import { DEFAULT_METRICS } from '@/features/feed/components/nostr/feedTypes';
import type { FeedParseResult } from './feedClient';

type MapNaggFeedPageOptions = Omit<
  BaseMapNaggFeedPageOptions<FeedEvent, ProfileInfo>,
  'collectReferences' | 'defaultMetrics'
>;

export function mapNaggFeedPage(
  page: NaggFeedPage<FeedEvent, ProfileInfo>,
  options: MapNaggFeedPageOptions = {}
): FeedParseResult {
  const mapped = mapNaggFeedPageBase(page, {
    ...options,
    collectReferences: collectReferencedIds,
    defaultMetrics: DEFAULT_METRICS,
  });
  const last = mapped.orderedFeedItems.at(-1);
  return {
    ...mapped,
    hasMore: page.hasMore,
    paginationCursor:
      last && page.paginationUntil > 0
        ? {
            createdAt: page.paginationUntil,
            id: last.type === 'note' ? last.event.id : last.repostEvent.id,
          }
        : null,
  };
}
