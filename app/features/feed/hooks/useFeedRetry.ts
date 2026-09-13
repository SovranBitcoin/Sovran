import { useEffect } from 'react';
import { feedLog } from '@/shared/lib/logger';
import type { createFeedRetryTimer } from '../data/feedPagination';

/** A single retry owned by the active HomeFeed load callback and its lifetime. */
export function useFeedRetry(
  status: { retryAfterMs?: number },
  retry: () => Promise<unknown>,
  timer: ReturnType<typeof createFeedRetryTimer>
) {
  useEffect(() => {
    if (status.retryAfterMs === undefined) return;
    timer.schedule(status.retryAfterMs, () => {
      feedLog.info('feed.home.load_more_retry');
      void retry();
    });
    return () => timer.clear();
  }, [status, timer, retry]);
}
