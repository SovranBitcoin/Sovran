/**
 * @fileoverview Feed rows for a list, with row identity preserved across
 * rebuilds.
 *
 * `buildFeedRows` reuses the previous row object whenever a row's content is
 * unchanged, which is what keeps the list from re-rendering every card when one
 * map updates. That requires feeding the last result back in — a protocol every
 * caller would otherwise have to remember. This owns it.
 */

import { useEffect, useMemo, useRef } from 'react';

import type { EngagementViewState } from './useNostrEngagement';
import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import { buildFeedRows, type FeedRow } from '../lib/feedRows';

type FeedRowsOptions = {
  items: FeedItem[];
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  /**
   * Not read directly — rows come from `getDisplayMetrics`. Listed so late
   * aggregate counts rebuild the rows in the same commit they land in.
   */
  metricsMap: Map<string, NoteMetrics>;
  getDisplayMetrics: (eventId: string) => NoteMetrics;
  getEngagementState: (eventId: string) => EngagementViewState;
  resolveReposter?: (item: Extract<FeedItem, { type: 'repost' }>) => {
    name: string;
    pubkey: string;
  };
};

export function useFeedRows({
  items,
  profilesMap,
  quotedEventsMap,
  metricsMap,
  getDisplayMetrics,
  getEngagementState,
  resolveReposter,
}: FeedRowsOptions): FeedRow[] {
  const previousRowsRef = useRef<FeedRow[]>([]);

  const feedRows = useMemo(
    () =>
      buildFeedRows({
        items,
        previousRows: previousRowsRef.current,
        profilesMap,
        quotedEventsMap,
        getDisplayMetrics,
        getEngagementState,
        resolveReposter,
      }),
    [
      items,
      metricsMap,
      profilesMap,
      quotedEventsMap,
      getDisplayMetrics,
      getEngagementState,
      resolveReposter,
    ]
  );

  useEffect(() => {
    previousRowsRef.current = feedRows;
  }, [feedRows]);

  return feedRows;
}
