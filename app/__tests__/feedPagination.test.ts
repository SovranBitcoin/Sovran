import {
  advancedPaginationState,
  emptyPaginationState,
  isRankedFeedSpec,
  seededPaginationState,
} from '@/features/feed/data/feedPagination';

// The home feed pages two ways: ranked specs (for-you / following-popular) by
// absolute offset into the server's ranked pool, time specs by an exclusive
// `until`. These tests pin the regressions that killed For You's infinite
// scroll: a ranked page whose oldest timestamp is NEWER than the previous
// page's must keep paging (rank order is not chronological), and a time page
// must never echo an offset alongside its next `until` (that skips unseen
// events).

const item = (timestamp: number) => ({ timestamp });

const page = (paginationUntil: number, paginationOffset: number, timestamps: number[]) => ({
  paginationUntil,
  paginationOffset,
  orderedFeedItems: timestamps.map(item),
});

describe('isRankedFeedSpec', () => {
  it('marks the ranked home specs', () => {
    expect(isRankedFeedSpec(JSON.stringify({ id: 'for-you', kind: 'notes', hours: 24 }))).toBe(
      true
    );
    expect(
      isRankedFeedSpec(JSON.stringify({ id: 'following-popular', kind: 'notes', hours: 24 }))
    ).toBe(true);
  });

  it('leaves time-paged and malformed specs unranked', () => {
    expect(isRankedFeedSpec(JSON.stringify({ id: 'following-recent', kind: 'notes' }))).toBe(false);
    expect(isRankedFeedSpec(JSON.stringify({ id: 'for-you', kind: 'other' }))).toBe(false);
    expect(isRankedFeedSpec('not json')).toBe(false);
    expect(isRankedFeedSpec(undefined)).toBe(false);
  });
});

describe('seededPaginationState', () => {
  it('ranked: starts the cumulative offset at the first page size', () => {
    expect(seededPaginationState(page(1000, 15, [1200, 1000]), true)).toEqual({
      until: 1000,
      offset: 15,
      hasMore: true,
    });
  });

  it('ranked: an empty first page has no more', () => {
    expect(seededPaginationState(page(0, 0, []), true).hasMore).toBe(false);
  });

  it('time: starts with no offset and requires a cursor to page', () => {
    expect(seededPaginationState(page(1000, 15, [1200, 1000]), false)).toEqual({
      until: 1000,
      offset: 0,
      hasMore: true,
    });
    expect(seededPaginationState(page(0, 15, [1200, 1000]), false).hasMore).toBe(false);
  });
});

describe('advancedPaginationState — ranked', () => {
  const state = { until: 1000, offset: 15, hasMore: true };

  it('keeps paging when the next page is entirely NEWER than the last (For You regression)', () => {
    const next = advancedPaginationState(state, page(1500, 10, [1800, 1500]), true);
    expect(next).toEqual({ until: 1000, offset: 25, hasMore: true });
  });

  it('accumulates the offset instead of resetting it when timestamps do decrease', () => {
    const next = advancedPaginationState(state, page(900, 10, [950, 900]), true);
    expect(next).toEqual({ until: 900, offset: 25, hasMore: true });
  });

  it('always advances by at least one slot so a fully-filtered page cannot loop', () => {
    const next = advancedPaginationState(state, page(900, 0, [950]), true);
    expect(next.offset).toBe(16);
  });

  it('ends only on an empty page', () => {
    expect(advancedPaginationState(state, page(0, 0, []), true).hasMore).toBe(false);
  });
});

describe('advancedPaginationState — time', () => {
  const state = { until: 1000, offset: 0, hasMore: true };

  it('advances by until alone — no offset echo (Recent skip regression)', () => {
    const next = advancedPaginationState(state, page(900, 10, [990, 900]), false);
    expect(next).toEqual({ until: 900, offset: 0, hasMore: true });
  });

  it('steps a boundary-tie page by offset without moving until', () => {
    const tied = advancedPaginationState(state, page(1000, 10, [1000, 1000]), false);
    expect(tied).toEqual({ until: 1000, offset: 10, hasMore: true });
  });

  it('falls back to the oldest item timestamp when the page has no usable cursor', () => {
    const next = advancedPaginationState(state, page(0, 10, [990, 950]), false);
    expect(next).toEqual({ until: 950, offset: 0, hasMore: true });
  });

  it('ends when a cursorless page makes no progress', () => {
    expect(advancedPaginationState(state, page(0, 10, [1200]), false).hasMore).toBe(false);
  });

  it('ends on an empty page', () => {
    expect(advancedPaginationState(state, page(0, 0, []), false).hasMore).toBe(false);
  });
});

describe('emptyPaginationState', () => {
  it('allows the first load to run', () => {
    expect(emptyPaginationState()).toEqual({ until: 0, offset: 0, hasMore: true });
  });
});
