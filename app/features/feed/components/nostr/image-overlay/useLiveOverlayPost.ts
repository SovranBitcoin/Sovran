import { useMemo } from 'react';

import { useNoteEngagement } from '@/features/feed/hooks/useNoteEngagement';

import { DEFAULT_METRICS, type NoteMetrics } from '../feedTypes';
import type { ImageOverlayPost } from './types';

/**
 * The post the overlay shows, following its own note's engagement: liking it
 * from the overlay, or from the card underneath, updates the panel. The post
 * handed to `open` is a snapshot, so without this the panel would freeze at the
 * counts it opened with.
 *
 * A surface opts in by supplying `getBaseMetrics`, its own counts for a note;
 * without it the snapshot is shown as it was opened. The result keeps its
 * identity until the post or something it shows changes — the overlay's
 * context value is built from it.
 */
export function useLiveOverlayPost(
  post: ImageOverlayPost | null,
  getBaseMetrics: ((eventId: string) => NoteMetrics) | undefined
): ImageOverlayPost | null {
  const eventId = getBaseMetrics ? post?.event.id : undefined;
  const fallbackMetrics = eventId && getBaseMetrics ? getBaseMetrics(eventId) : DEFAULT_METRICS;
  const { metrics, state } = useNoteEngagement(eventId, fallbackMetrics);

  return useMemo(() => {
    if (!post || !eventId) return post;
    return {
      ...post,
      metrics,
      liked: state.liked,
      reposted: state.reposted,
      likePending: state.likePending,
      repostPending: state.repostPending,
      likePendingDirection: state.likePendingDirection,
      repostPendingDirection: state.repostPendingDirection,
    };
  }, [post, eventId, metrics, state]);
}
