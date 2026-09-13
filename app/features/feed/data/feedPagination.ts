import type { FeedParseResult } from './feedClient';

type PaginationPage = Pick<FeedParseResult, 'paginationCursor' | 'hasMore' | 'orderedFeedItems'>;
export type FeedPaginationState = {
  cursor: FeedParseResult['paginationCursor'];
  hasMore: boolean;
};

export function emptyPaginationState(): FeedPaginationState {
  return { cursor: null, hasMore: true };
}

export function seededPaginationState(page: PaginationPage): FeedPaginationState {
  return {
    cursor: page.paginationCursor,
    hasMore: page.hasMore ?? page.orderedFeedItems.length > 0,
  };
}

export function advancedPaginationState(
  state: FeedPaginationState,
  page: PaginationPage
): FeedPaginationState {
  return {
    cursor: page.paginationCursor ?? state.cursor,
    hasMore: page.hasMore ?? state.hasMore,
  };
}

/** One pending retry per feed owner; timer injection keeps lifecycle tests deterministic. */
export function createFeedRetryTimer(timer = { setTimeout, clearTimeout }) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (pending !== undefined) timer.clearTimeout(pending);
    pending = undefined;
  };
  return {
    clear,
    schedule(delayMs: number, retry: () => void) {
      clear();
      pending = timer.setTimeout(() => {
        pending = undefined;
        retry();
      }, delayMs);
    },
  };
}
