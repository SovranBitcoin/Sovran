import { act, renderHook } from '@testing-library/react-native';
import { useFeedContentState } from '@/features/feed/hooks/useFeedContentState';
import { emptyFeedParseResult } from '@/features/feed/data/feedClient';
import type { FeedItem } from '@/features/feed/components/nostr/feedTypes';
import { backfillNoteStats, ingestFeedMetrics } from '@/shared/lib/nostr/fetchNoteStats';

jest.mock('@/shared/lib/nostr/fetchNoteStats', () => ({
  backfillNoteStats: jest.fn(async () => undefined),
  ingestFeedMetrics: jest.fn(),
}));
jest.mock('@/features/feed/stores/ignoreStore', () => ({
  useFeedIgnoreStore: (
    selector: (s: { ignoredPubkeys: string[]; ignoredEventIds: string[] }) => unknown
  ) => selector({ ignoredPubkeys: [], ignoredEventIds: [] }),
}));

const note = (id: string): FeedItem => ({
  type: 'note',
  timestamp: 1,
  event: { id, pubkey: 'p'.repeat(64), kind: 1, content: '', tags: [], created_at: 1 },
});

beforeEach(() => jest.clearAllMocks());

it("shares a page's counts with the entity cache and backfills the notes the page did not count", () => {
  const { result } = renderHook(() => useFeedContentState());
  const withStats = 'a'.repeat(64);
  const without = 'b'.repeat(64);
  const page = {
    ...emptyFeedParseResult(),
    orderedFeedItems: [note(withStats), note(without)],
    metricsMap: new Map([
      [withStats, { likeCount: 2, repostCount: 0, replyCount: 0, satsZapped: 0 }],
    ]),
    sources: ['relay' as const],
  };
  act(() => result.current.applyPage(page));
  expect(ingestFeedMetrics).toHaveBeenCalledWith(page.metricsMap, 'relay');
  expect(backfillNoteStats).toHaveBeenCalledWith([without]);
});

it('does not backfill when every note already has counts', () => {
  const { result } = renderHook(() => useFeedContentState());
  const id = 'c'.repeat(64);
  act(() =>
    result.current.applyPage({
      ...emptyFeedParseResult(),
      orderedFeedItems: [note(id)],
      metricsMap: new Map([[id, { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 }]]),
    })
  );
  expect(backfillNoteStats).not.toHaveBeenCalled();
});
