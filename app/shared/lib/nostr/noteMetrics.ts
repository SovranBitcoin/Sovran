import type { NoteStats } from '@sovranbitcoin/schemas';

import type { NoteMetrics } from '@/features/feed/components/nostr/feedTypes';

/** The shared `NoteStats` contract → `NoteMetrics`, the shape the feed's rows read. */
export function noteMetricsFromStats(
  stats: Pick<NoteStats, 'likes' | 'reposts' | 'replies' | 'satsZapped'>
): NoteMetrics {
  return {
    likeCount: stats.likes,
    repostCount: stats.reposts,
    replyCount: stats.replies,
    satsZapped: stats.satsZapped,
  };
}
