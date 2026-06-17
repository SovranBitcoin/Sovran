/**
 * Contextual feed empty-state mode selection.
 */
import {
  selectFeedEmptyMode,
  FEED_EMPTY_COPY,
  type FeedEmptySignals,
} from '@/features/feed/lib/feedEmptyStates';

const base: FeedEmptySignals = {
  isLoading: false,
  hasError: false,
  rowCount: 0,
  isFollowingFeed: false,
  followCount: 0,
};

describe('selectFeedEmptyMode', () => {
  it('loading takes precedence', () => {
    expect(selectFeedEmptyMode({ ...base, isLoading: true, hasError: true })).toBe('loading');
  });

  it('unreachable when an error left the feed empty', () => {
    expect(selectFeedEmptyMode({ ...base, hasError: true, rowCount: 0 })).toBe('unreachable');
  });

  it('no-follows on a following feed with zero follows', () => {
    expect(selectFeedEmptyMode({ ...base, isFollowingFeed: true, followCount: 0 })).toBe(
      'no-follows'
    );
  });

  it('empty otherwise (loaded, no error, follows exist)', () => {
    expect(
      selectFeedEmptyMode({ ...base, isFollowingFeed: true, followCount: 5, rowCount: 0 })
    ).toBe('empty');
  });

  it('every non-loading mode has copy with an icon and title', () => {
    for (const mode of ['unreachable', 'no-follows', 'empty'] as const) {
      expect(FEED_EMPTY_COPY[mode].icon).toBeTruthy();
      expect(FEED_EMPTY_COPY[mode].title).toBeTruthy();
    }
  });
});
