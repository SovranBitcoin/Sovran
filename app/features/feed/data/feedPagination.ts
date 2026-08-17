import { parseJson } from '../components/nostr/feedParse';

// Home-feed pagination state. Two paging regimes share it:
//
// - RANKED specs (`for-you` / `following-popular`) page by ABSOLUTE OFFSET into
//   the server's ranked pool. Rank order is not chronological, so a page's
//   oldest timestamp says nothing about progress — a later page can be entirely
//   NEWER than an earlier one. `until` is still tracked (oldest seen so far)
//   for tiers that can only page by time, but it never gates or stops paging.
//
// - TIME specs page by `until` alone. nagg's `until` is exclusive
//   (`created_at < until`), so the cursor by itself is the complete next-page
//   key; echoing an offset alongside it skips that many UNSEEN events. Offset
//   only steps through a pathological page whose items all share the boundary
//   timestamp (an inclusive-until tier answering).
type FeedPaginationState = {
  until: number;
  offset: number;
  hasMore: boolean;
};

type PaginationPage = {
  paginationUntil: number;
  paginationOffset: number;
  orderedFeedItems: readonly { timestamp: number }[];
};

export function isRankedFeedSpec(spec: string | undefined): boolean {
  if (!spec) return false;
  const parsed = parseJson<Record<string, unknown>>(spec);
  return parsed?.kind === 'notes' && (parsed.id === 'for-you' || parsed.id === 'following-popular');
}

export function emptyPaginationState(): FeedPaginationState {
  return { until: 0, offset: 0, hasMore: true };
}

/** State after a page-0 result (fresh load, refresh, or cache seed). */
export function seededPaginationState(page: PaginationPage, ranked: boolean): FeedPaginationState {
  if (ranked) {
    return {
      until: page.paginationUntil,
      offset: page.paginationOffset,
      hasMore: page.orderedFeedItems.length > 0,
    };
  }
  return {
    until: page.paginationUntil,
    offset: 0,
    hasMore: page.paginationUntil > 0 && page.orderedFeedItems.length > 0,
  };
}

/**
 * State after a load-more page. `hasMore: false` means the feed ended and the
 * page carried nothing new to append.
 */
export function advancedPaginationState(
  state: FeedPaginationState,
  page: PaginationPage,
  ranked: boolean
): FeedPaginationState {
  if (page.orderedFeedItems.length === 0) return { ...state, hasMore: false };
  if (ranked) {
    return {
      until:
        page.paginationUntil > 0 && page.paginationUntil < state.until
          ? page.paginationUntil
          : state.until,
      offset: state.offset + Math.max(page.paginationOffset, 1),
      hasMore: true,
    };
  }
  if (page.paginationUntil > 0 && page.paginationUntil < state.until) {
    return { until: page.paginationUntil, offset: 0, hasMore: true };
  }
  if (page.paginationUntil === state.until) {
    // Every item sits at the boundary timestamp: step past it by offset.
    return { until: state.until, offset: state.offset + page.paginationOffset, hasMore: true };
  }
  // No usable cursor on the page — fall back to the oldest item timestamp.
  let oldest = state.until;
  for (const item of page.orderedFeedItems) {
    if (item.timestamp < oldest) oldest = item.timestamp;
  }
  if (oldest >= state.until) return { ...state, hasMore: false };
  return { until: oldest, offset: 0, hasMore: true };
}
