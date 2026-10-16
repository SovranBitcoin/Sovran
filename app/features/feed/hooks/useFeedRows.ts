/**
 * @fileoverview Feed rows for a list, with row identity preserved across
 * rebuilds.
 *
 * `buildFeedRows` reuses the previous row object whenever a row's content is
 * unchanged, which is what keeps the list from re-rendering every card when one
 * map updates. That requires feeding the last result back in — a protocol every
 * caller would otherwise have to remember. This owns it.
 *
 * A row carries the surface's own counts and no viewer state: the viewer's
 * likes, reposts and zaps are read by each card for its own note
 * (`useNoteEngagement`), so one like does not rebuild the rows.
 */

import { useEffect, useMemo, useRef } from 'react';

import type { NoteMetrics } from '../components/nostr/feedTypes';
import { buildFeedRows, type BuildFeedRowsOptions, type FeedRow } from '../lib/feedRows';

/**
 * Everything `buildFeedRows` takes except the previous rows — the hook owns
 * those, since row-identity reuse is the protocol callers kept getting wrong.
 */
type FeedRowsOptions = Pick<
  BuildFeedRowsOptions,
  'items' | 'profilesMap' | 'quotedEventsMap' | 'resolveReposter'
> & {
  /**
   * Not read directly — rows come from `getMetrics`. Listed so late aggregate
   * counts rebuild the rows in the same commit they land in.
   */
  metricsMap: Map<string, NoteMetrics>;
  /** The surface's counts for a note, before any optimistic overlay. */
  getMetrics: (eventId: string) => NoteMetrics;
};

export function useFeedRows({
  items,
  profilesMap,
  quotedEventsMap,
  metricsMap,
  getMetrics,
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
        getDisplayMetrics: getMetrics,
        hasMetrics: (id) => metricsMap.has(id),
        resolveReposter,
      }),
    [
      items,
      // Deliberate trigger, not an input: `getMetrics` closes over the map, so
      // rows must rebuild when it changes even though the body never names it.
      metricsMap,
      profilesMap,
      quotedEventsMap,
      getMetrics,
      resolveReposter,
    ]
  );

  useEffect(() => {
    previousRowsRef.current = feedRows;
  }, [feedRows]);

  return feedRows;
}
