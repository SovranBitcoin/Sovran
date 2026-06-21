import { useEffect, useRef } from 'react';

import { fetchNoteStats } from '@/features/feed/data/noteStatsClient';
import type { NoteMetrics } from '@/features/feed/components/nostr/feedTypes';

/**
 * Lazily fill engagement counts for the given note ids from nagg's reliable
 * `/nostr/notes/stats` endpoint and hand them back to merge into the surface's
 * metrics map. The inline feed `noteStats` join is flaky, so this is what makes
 * like/repost/reply/zap counts actually appear (animating in via MetricsFooter).
 *
 * Each id is fetched at most once per hook lifetime, batched per render tick, so
 * scrolling a feed issues one `/nostr/notes/stats` POST per new window of notes
 * rather than refetching counts we already resolved.
 */
export function useLazyNoteStats(
  noteIds: readonly string[],
  onStats: (stats: Map<string, NoteMetrics>) => void,
  /** Only fetch when the nagg tier is on. With nagg off the feed is served by
   *  Primal (which bundles its own stats) or raw relays (which honestly have no
   *  aggregate counts), so pulling nagg's counts would break the tier toggles. */
  enabled = true
): void {
  const attempted = useRef<Set<string>>(new Set());
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  // Stable trigger: only re-run when the set of ids (or the gate) changes.
  const key = `${enabled ? '1' : '0'}:${[...noteIds].sort().join(',')}`;

  useEffect(() => {
    if (!enabled) return;
    const missing = noteIds.filter((id) => id.length === 64 && !attempted.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) attempted.current.add(id);

    let cancelled = false;
    void fetchNoteStats(missing).then((stats) => {
      if (!cancelled && stats.size > 0) onStatsRef.current(stats);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
