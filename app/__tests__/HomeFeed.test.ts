import { renderHook } from '@testing-library/react-native';
import { createFeedRetryTimer } from '@/features/feed/data/feedPagination';
import { feedFooterCopy } from '@/features/feed/lib/feedEmptyStates';
import { useFeedRetry } from '@/features/feed/hooks/useFeedRetry';

jest.mock('@/shared/lib/logger', () => ({ feedLog: { info: jest.fn() } }));
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('schedules one HomeFeed retry and replaces the pending retry', () => {
  const timer = createFeedRetryTimer({ setTimeout, clearTimeout });
  const retry = jest.fn(async () => []);
  const { rerender } = renderHook<void, { retryAfterMs: number }>(
    ({ retryAfterMs }) => useFeedRetry({ retryAfterMs }, retry, timer),
    {
      initialProps: { retryAfterMs: 1_000 },
    }
  );
  rerender({ retryAfterMs: 4_000 });
  jest.advanceTimersByTime(1_000);
  expect(retry).not.toHaveBeenCalled();
  jest.advanceTimersByTime(3_000);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('cancels the mounted HomeFeed retry on unmount', () => {
  const timer = createFeedRetryTimer({ setTimeout, clearTimeout });
  const retry = jest.fn(async () => []);
  const { unmount } = renderHook(() => useFeedRetry({ retryAfterMs: 1_000 }, retry, timer));
  unmount();
  jest.runAllTimers();
  expect(retry).not.toHaveBeenCalled();
});

it('cancels a superseded feed callback when a fresh load clears retry status', () => {
  const timer = createFeedRetryTimer({ setTimeout, clearTimeout });
  const oldRetry = jest.fn(async () => []);
  const newRetry = jest.fn(async () => []);
  const { rerender } = renderHook<
    void,
    { status: { retryAfterMs?: number }; retry: () => Promise<unknown> }
  >(({ status, retry }) => useFeedRetry(status, retry, timer), {
    initialProps: { status: { retryAfterMs: 1_000 }, retry: oldRetry },
  });
  rerender({ status: { retryAfterMs: undefined }, retry: newRetry });
  jest.runAllTimers();
  expect(oldRetry).not.toHaveBeenCalled();
  expect(newRetry).not.toHaveBeenCalled();
});

it('shows retry status before degraded recency and clears it after recovery', () => {
  expect(feedFooterCopy({ retryAfterMs: 0, showingRecent: true })).toBe('Retrying…');
  expect(feedFooterCopy({ showingRecent: true })).toBe('Showing recent posts');
  expect(feedFooterCopy({})).toBeNull();
});
