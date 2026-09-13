import { useFeedIgnoreStore } from '../stores/ignoreStore';
import { moderateFeedItems } from '../lib/moderation';
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

import { useCallback, useMemo, useState, useTransition } from 'react';

import type { FeedEnrichmentUpdates, FeedParseResult } from '@/features/feed/data/feedClient';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { backfillNoteStats, ingestFeedMetrics } from '@/shared/lib/nostr/fetchNoteStats';

import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';

/** The slice of a parsed page this hook stores — pagination stays with the caller. */
type FeedContentPage = Pick<
  FeedParseResult,
  'orderedFeedItems' | 'metricsMap' | 'quotedEventsMap' | 'profilesMap'
> &
  Partial<Pick<FeedParseResult, 'sources'>>;

/**
 * A page's counts go to the entity cache (every row binding sees them), and
 * the notes it did NOT carry counts for are backfilled across tiers — those
 * rows show a placeholder, never a zero, until a source answers.
 */
function shareMetrics(page: FeedContentPage, items: readonly FeedItem[]): void {
  ingestFeedMetrics(page.metricsMap, page.sources?.[0] ?? 'nagg');
  const missing: string[] = [];
  for (const item of items) {
    const id = item.type === 'note' ? item.event.id : item.originalEventId;
    if (!page.metricsMap.has(id)) missing.push(id);
    if (item.rootEvent && !page.metricsMap.has(item.rootEvent.id)) missing.push(item.rootEvent.id);
  }
  if (missing.length > 0) void backfillNoteStats(missing);
}

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
    const visible = items ?? page.orderedFeedItems;
    setFeedItems(visible);
    setMetricsMap(page.metricsMap);
    setQuotedEventsMap(page.quotedEventsMap);
    setProfilesMap(page.profilesMap);
    shareMetrics(page, visible);
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
      shareMetrics(page, items);
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
      if (updates.metrics) ingestFeedMetrics(updates.metrics, 'nagg');
    },
    [startTransition]
  );

  const ignoredPeople = useFeedIgnoreStore((s) => s.ignoredPubkeys);
  const ignoredEvents = useFeedIgnoreStore((s) => s.ignoredEventIds);
  const visibleItems = useMemo(
    () => moderateFeedItems(feedItems, ignoredPeople, ignoredEvents),
    [feedItems, ignoredPeople, ignoredEvents]
  );

  return {
    feedItems: visibleItems,
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
