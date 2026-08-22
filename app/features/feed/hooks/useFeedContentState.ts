/**
 * @fileoverview Shared feed content state.
 *
 * Every feed surface paints from the same four things: the ordered items and
 * the metrics / quoted-event / profile lookup maps. It fetches a page, paints
 * it, then folds late enrichment (quoted posts resolving, author names and
 * avatars filling in) into those maps.
 *
 * Owning that here keeps one copy of the merge protocol: the page that produces
 * the first paint is applied synchronously, while every later merge runs inside
 * a transition so the list stays scrollable while its rows re-render. Callers
 * keep their own pagination — the cursor rules differ per surface.
 */

import { useCallback, useState, useTransition } from 'react';

import type { FeedEnrichmentUpdates, FeedParseResult } from '@/features/feed/data/feedClient';
import { useLatestRef } from '@/shared/hooks/useLatestRef';

import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';

/** The slice of a parsed page this hook stores — pagination stays with the caller. */
type FeedContentPage = Pick<
  FeedParseResult,
  'orderedFeedItems' | 'metricsMap' | 'quotedEventsMap' | 'profilesMap'
>;

function mergedMap<V>(previous: Map<string, V>, incoming: Map<string, V>): Map<string, V> {
  const next = new Map(previous);
  for (const [key, value] of incoming) next.set(key, value);
  return next;
}

export function useFeedContentState(seed?: FeedContentPage) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>(() => seed?.orderedFeedItems ?? []);
  const [metricsMap, setMetricsMap] = useState<Map<string, NoteMetrics>>(
    () => seed?.metricsMap ?? new Map()
  );
  const [quotedEventsMap, setQuotedEventsMap] = useState<Map<string, FeedEvent>>(
    () => seed?.quotedEventsMap ?? new Map()
  );
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(
    () => seed?.profilesMap ?? new Map()
  );
  const [, startTransition] = useTransition();

  // Stable mirrors for handlers and render callbacks that must not re-create on
  // every map update.
  const metricsRef = useLatestRef(metricsMap);
  const quotedRef = useLatestRef(quotedEventsMap);
  const profilesRef = useLatestRef(profilesMap);

  /** Drop every row and lookup — a cold load, an author switch, or a failed load. */
  const resetContent = useCallback(() => {
    setFeedItems([]);
    setMetricsMap(new Map());
    setQuotedEventsMap(new Map());
    setProfilesMap(new Map());
  }, []);

  /**
   * Replace all content with a freshly fetched page. Not a transition: this is
   * the paint the user is waiting on. `items` overrides the page's own ordering
   * for surfaces that filter rows out before display.
   */
  const applyPage = useCallback((page: FeedContentPage, items?: FeedItem[]) => {
    setFeedItems(items ?? page.orderedFeedItems);
    setMetricsMap(page.metricsMap);
    setQuotedEventsMap(page.quotedEventsMap);
    setProfilesMap(page.profilesMap);
  }, []);

  /** Append a pagination page: new rows plus that page's lookups. */
  const appendPage = useCallback(
    (page: FeedContentPage, items: FeedItem[]) => {
      startTransition(() => {
        if (items.length > 0) setFeedItems((prev) => [...prev, ...items]);
        setMetricsMap((prev) => mergedMap(prev, page.metricsMap));
        setQuotedEventsMap((prev) => mergedMap(prev, page.quotedEventsMap));
        setProfilesMap((prev) => mergedMap(prev, page.profilesMap));
      });
    },
    [startTransition]
  );

  /** Fold post-paint enrichment into the lookups, leaving the row order alone. */
  const applyEnrichment = useCallback(
    (updates: FeedEnrichmentUpdates) => {
      startTransition(() => {
        const { quotedEvents, metrics, profiles } = updates;
        if (quotedEvents) setQuotedEventsMap((prev) => mergedMap(prev, quotedEvents));
        if (metrics) setMetricsMap((prev) => mergedMap(prev, metrics));
        if (profiles) setProfilesMap((prev) => mergedMap(prev, profiles));
      });
    },
    [startTransition]
  );

  return {
    feedItems,
    metricsMap,
    quotedEventsMap,
    profilesMap,
    metricsRef,
    quotedRef,
    profilesRef,
    resetContent,
    applyPage,
    appendPage,
    applyEnrichment,
  };
}
