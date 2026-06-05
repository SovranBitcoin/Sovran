import {
  mapNaggFeedPage as mapNaggFeedPageBase,
  type MapNaggFeedPageOptions as BaseMapNaggFeedPageOptions,
  type NaggFeedPage,
} from 'nagg-ts/map';
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
  return mapNaggFeedPageBase(page, {
    ...options,
    collectReferences: collectReferencedIds,
    defaultMetrics: DEFAULT_METRICS,
  });
}
