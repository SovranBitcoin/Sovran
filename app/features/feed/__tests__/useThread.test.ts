import { StrictMode, useLayoutEffect } from 'react';
import { InteractionManager } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useThread } from '../hooks/useThread';
import { seedThread } from '../lib/threadSeedCache';
import type { ThreadResult, ThreadSeedBuckets } from '../data/feedClient';

const mockGetThread = jest.fn();
const mockReadThread = jest.fn();
let mockViewerPubkey = 'viewer';
const mockIgnored = { ignoredPubkeys: [], ignoredEventIds: [] };

jest.mock('../data/useFeedClient', () => ({
  getFeedClient: () => ({ getThread: mockGetThread }),
}));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ readThread: mockReadThread }),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: mockViewerPubkey } }),
}));
jest.mock('../stores/ignoreStore', () => ({
  useFeedIgnoreStore: (select: (state: typeof mockIgnored) => unknown) => select(mockIgnored),
}));
jest.mock('@/shared/stores/profile/ownContentStore', () => ({
  useOwnContentStore: { getState: () => ({ getOwn: () => undefined }) },
  ingestOwnContent: jest.fn(),
}));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({ ingestOwnMediaBlobs: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  feedLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function seed(eventId: string): ThreadSeedBuckets {
  return {
    allEvents: new Map([
      [
        eventId,
        { id: eventId, kind: 1, pubkey: 'author', content: 'Known post', tags: [], created_at: 1 },
      ],
    ]),
    profiles: new Map([['author', { name: 'Known author' }]]),
    metrics: new Map(),
    quotedEvents: new Map(),
  };
}

describe('useThread known-content loading', () => {
  let runDeferred: () => void;

  beforeEach(() => {
    mockViewerPubkey = 'viewer';
    mockGetThread.mockReset().mockImplementation(() => new Promise(() => {}));
    mockReadThread.mockReset().mockReturnValue({ root: null });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((callback) => {
      if (typeof callback !== 'function') throw new Error('Expected a deferred callback');
      runDeferred = callback;
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('commits a known navigation post and author before effects or the deferred fetch', () => {
    seedThread('known', seed('known'));
    const commits: { loading: boolean; content: string | undefined; author: string | undefined }[] =
      [];
    renderHook(() => {
      const thread = useThread('known');
      useLayoutEffect(() => {
        const target = thread.items.find((item) => item.type === 'target');
        commits.push({
          loading: thread.isLoading,
          content: target?.event.content,
          author: thread.profilesRef.current.get('author')?.name,
        });
      });
      return thread;
    });

    expect(commits[0]).toEqual({ loading: false, content: 'Known post', author: 'Known author' });
    expect(mockGetThread).not.toHaveBeenCalled();
    act(() => runDeferred());
    expect(mockGetThread).toHaveBeenCalledTimes(1);
  });

  it('preserves the handoff through Strict Mode replay and a failed background refresh', async () => {
    seedThread('strict', seed('strict'));
    mockGetThread.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useThread('strict'), { wrapper: StrictMode });

    await act(async () => runDeferred());

    expect(result.current.items).toEqual([
      { type: 'target', event: seed('strict').allEvents.get('strict') },
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('uses the shared entity cache on the first commit without a navigation handoff', () => {
    const cached = seed('cached');
    mockReadThread.mockReturnValue({
      root: cached.allEvents.get('cached'),
      relatedNotes: [],
      stats: {},
      profiles: Object.fromEntries(cached.profiles),
      quoted: {},
    });
    const commits: boolean[] = [];
    const { result } = renderHook(() => {
      const thread = useThread('cached');
      useLayoutEffect(() => {
        commits.push(thread.isLoading);
      });
      return thread;
    });

    expect(commits[0]).toBe(false);
    expect(result.current.items[0]).toEqual({
      type: 'target',
      event: cached.allEvents.get('cached'),
    });
  });

  it('ends cold loading with an error when an unusable handoff cannot be fetched', async () => {
    seedThread('missing', seed('different-post'));
    mockGetThread.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useThread('missing'));

    await act(async () => runDeferred());

    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBe('Failed to load thread');
  });

  it.each(['success', 'failure'])(
    'ignores an old viewer request after profile switch (%s)',
    async (outcome) => {
      let resolveOld!: (value: ThreadResult) => void;
      let rejectOld!: (error: Error) => void;
      mockGetThread.mockImplementationOnce(
        () =>
          new Promise<ThreadResult>((resolve, reject) => {
            resolveOld = resolve;
            rejectOld = reject;
          })
      );
      const previous = seed('profile-note');
      seedThread('profile-note', previous);
      const { result, rerender } = renderHook(() => useThread('profile-note'));
      act(() => runDeferred());
      const oldSignal = mockGetThread.mock.calls[0][0].signal as AbortSignal;

      mockViewerPubkey = 'another-viewer';
      rerender(undefined);
      expect(oldSignal.aborted).toBe(true);
      expect(result.current.items).toEqual([]);
      expect(result.current.profilesRef.current.size).toBe(0);

      await act(async () => {
        if (outcome === 'failure') rejectOld(new Error('old viewer request failed'));
        else
          resolveOld({
            ...previous,
            thread: { target: previous.allEvents.get('profile-note')!, parents: [], replies: [] },
            replyPageEventIds: [],
            replyPageSize: 10,
            tier: 'cache',
            knownReplyIds: [],
            loadedReplyCount: 0,
            hasMoreReplies: false,
          });
      });

      expect(result.current.items).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isFetching).toBe(true);
    }
  );
});
