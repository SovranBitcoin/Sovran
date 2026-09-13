import {
  advancedPaginationState,
  emptyPaginationState,
  seededPaginationState,
} from '@/features/feed/data/feedPagination';
import { emptyFeedParseResult } from '@/features/feed/data/feedClient';

it('keeps an empty recoverable page pageable and retains the real cursor', () => {
  const cursor = { createdAt: 100, id: 'boundary' };
  const state = seededPaginationState({
    ...emptyFeedParseResult(),
    paginationCursor: cursor,
    hasMore: true,
  });
  expect(state).toEqual({ cursor, hasMore: true });
  expect(advancedPaginationState(state, { ...emptyFeedParseResult(), hasMore: true })).toEqual(
    state
  );
});

it('accepts the pager terminal state even when the final page contains posts', () => {
  const page = {
    ...emptyFeedParseResult(),
    hasMore: false,
    paginationCursor: { createdAt: 90, id: 'last' },
    orderedFeedItems: [
      {
        type: 'note' as const,
        timestamp: 90,
        event: { id: 'last', pubkey: 'author', kind: 1, content: '', tags: [], created_at: 90 },
      },
    ],
  };
  expect(advancedPaginationState(emptyPaginationState(), page)).toEqual({
    cursor: page.paginationCursor,
    hasMore: false,
  });
});

it('does not infer exhaustion from a duplicate or missing legacy continuation hint', () => {
  expect(
    advancedPaginationState(emptyPaginationState(), {
      ...emptyFeedParseResult(),
      hasMore: undefined,
    }).hasMore
  ).toBe(true);
});
