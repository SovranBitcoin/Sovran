/**
 * `useThread` reply paging: what the first fetch asks for, how load-more
 * reveals the next replies from the stack it already holds, when it goes to
 * the network for more, what a sort change restarts, and what a failed or
 * stale page does. The hook and its thread-item builders run for real; the
 * feed client, the data layer, the keys provider, the ignore store and the
 * own-content stores are replaced. First paint from a seed is pinned in
 * useThread.test.ts.
 */
import { InteractionManager } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useThread } from '../hooks/useThread';
import type { FeedEvent } from '../components/nostr/feedTypes';
import type { ThreadResult } from '../data/feedClient';

const mockGetThread = jest.fn();
const mockIgnored = { ignoredPubkeys: [], ignoredEventIds: [] };

jest.mock('../data/useFeedClient', () => ({
  getFeedClient: () => ({ getThread: mockGetThread }),
}));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ readThread: () => ({ root: null }) }),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'viewer' } }),
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

const TARGET = 't'.repeat(64);
const note = (id: string): FeedEvent => ({
  id,
  kind: 1,
  pubkey: `author-${id}`,
  content: id,
  tags: [['e', TARGET, '', 'reply']],
  created_at: 1,
});
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `r${String(from + i).padStart(2, '0')}`);

/**
 * A source answer, built the way the facade thread adapter builds one: the
 * events it already had (the request's seed) plus this page's, every known
 * direct reply in `thread.replies`, `shown` as the page window and `stack`
 * as the full ordered reply list it holds.
 */
function page(
  shown: string[],
  stack: string[] | undefined,
  options: { hasMore?: boolean; serverHasMore?: boolean } = {}
) {
  return (request: { seed?: { allEvents: Map<string, FeedEvent> } }): ThreadResult => {
    const target = { ...note(TARGET), tags: [] };
    const allEvents = new Map(request.seed?.allEvents ?? []);
    allEvents.set(TARGET, target);
    for (const id of [...shown, ...(stack ?? [])]) allEvents.set(id, note(id));
    const replies = [...allEvents.values()].filter((event) => event.id !== TARGET);
    return {
      allEvents,
      profiles: new Map(),
      metrics: new Map(),
      quotedEvents: new Map(),
      thread: { parents: [], target, replies },
      replyPageEventIds: shown,
      replyPageSize: 10,
      loadedReplyCount: shown.length,
      hasMoreReplies: options.hasMore ?? true,
      tier: 'relay',
      knownReplyIds: replies.map((event) => event.id),
      ...(stack ? { allSortedReplyIds: stack } : {}),
      ...(options.serverHasMore !== undefined
        ? { serverHasMoreReplies: options.serverHasMore }
        : {}),
    };
  };
}

const replyIds = (result: { current: ReturnType<typeof useThread> }) =>
  result.current.items.filter((item) => item.type === 'reply').map((item) => item.event.id);

async function open(first: ReturnType<typeof page>) {
  mockGetThread.mockImplementationOnce(async (request) => first(request));
  const view = renderHook(({ id }: { id: string }) => useThread(id), {
    initialProps: { id: TARGET },
  });
  await act(async () => undefined);
  return view;
}

beforeEach(() => {
  mockGetThread.mockReset();
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((callback) => {
    if (typeof callback === 'function') callback();
    return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
  });
});

afterEach(() => jest.restoreAllMocks());

describe('first page', () => {
  it('asks for ten replies from offset 0 in the relevant order and shows them', async () => {
    const { result } = await open(page(ids(1, 10), ids(1, 25)));

    expect(mockGetThread).toHaveBeenCalledTimes(1);
    expect(mockGetThread.mock.calls[0][0]).toMatchObject({
      eventId: TARGET,
      limit: 10,
      offset: 0,
      sort: 'relevant',
      viewerPubkey: 'viewer',
    });
    expect(result.current.items[0]).toMatchObject({ type: 'target' });
    expect(replyIds(result)).toEqual(ids(1, 10));
    expect(result.current.hasMoreReplies).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('load more', () => {
  it('reveals the next ten from the held stack without a network call, then stops', async () => {
    const { result } = await open(page(ids(1, 10), ids(1, 25), { serverHasMore: false }));

    await act(() => result.current.loadMoreReplies());
    expect(replyIds(result)).toEqual(ids(1, 20));
    expect(result.current.hasMoreReplies).toBe(true);

    await act(() => result.current.loadMoreReplies());
    expect(replyIds(result)).toEqual(ids(1, 25));
    expect(result.current.hasMoreReplies).toBe(false);

    await act(() => result.current.loadMoreReplies());
    expect(mockGetThread).toHaveBeenCalledTimes(1);
  });

  it('extends from the network at the end of the stack when the server has more', async () => {
    const { result } = await open(page(ids(1, 10), ids(1, 10), { serverHasMore: true }));
    mockGetThread.mockImplementationOnce(
      page(ids(9, 15), ids(9, 15), { hasMore: false, serverHasMore: false })
    );

    await act(() => result.current.loadMoreReplies());

    expect(mockGetThread).toHaveBeenCalledTimes(2);
    expect(mockGetThread.mock.calls[1][0]).toMatchObject({
      limit: 10,
      offset: 10,
      sort: 'relevant',
    });
    // Only replies not already shown are appended.
    expect(replyIds(result)).toEqual(ids(1, 15));
    expect(result.current.hasMoreReplies).toBe(false);
  });

  it('pages by offset over the network when the source holds no stack', async () => {
    const { result } = await open(page(ids(1, 10), undefined));
    mockGetThread.mockImplementationOnce(page(ids(11, 12), undefined, { hasMore: false }));

    await act(() => result.current.loadMoreReplies());

    expect(mockGetThread.mock.calls[1][0]).toMatchObject({ offset: 10 });
    expect(replyIds(result)).toEqual(ids(1, 12));
    expect(result.current.hasMoreReplies).toBe(false);
  });

  it('stops when a network page brings no replies', async () => {
    const { result } = await open(page(ids(1, 10), undefined));
    mockGetThread.mockImplementationOnce(page([], undefined));
    await act(() => result.current.loadMoreReplies());
    expect(result.current.hasMoreReplies).toBe(false);
  });

  it('keeps offering more and shows no error when a network page fails', async () => {
    const { result } = await open(page(ids(1, 10), undefined));
    mockGetThread.mockRejectedValueOnce(new Error('offline'));

    await act(() => result.current.loadMoreReplies());

    // QUIRK: a failed load-more is silent; the list just stays as it was.
    expect(result.current.hasMoreReplies).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoadingMoreReplies).toBe(false);
    expect(replyIds(result)).toEqual(ids(1, 10));
  });

  it('runs one network page at a time', async () => {
    const { result } = await open(page(ids(1, 10), undefined));
    let release!: (answer: ReturnType<typeof page>) => void;
    mockGetThread.mockImplementationOnce(
      (request) =>
        new Promise<ThreadResult>((resolve) => {
          release = (answer) => resolve(answer(request));
        })
    );

    await act(async () => {
      void result.current.loadMoreReplies();
    });
    expect(result.current.isLoadingMoreReplies).toBe(true);
    await act(() => result.current.loadMoreReplies());
    expect(mockGetThread).toHaveBeenCalledTimes(2);

    await act(async () => release(page(ids(11, 11), undefined, { hasMore: false })));
    expect(replyIds(result)).toEqual(ids(1, 11));
  });
});

describe('sort change and thread change', () => {
  it('a sort change fetches again from offset 0 and replaces the replies', async () => {
    const { result } = await open(page(ids(1, 10), ids(1, 25)));
    await act(() => result.current.loadMoreReplies());
    mockGetThread.mockImplementationOnce(page(ids(21, 25), ids(21, 25), { hasMore: false }));

    await act(async () => result.current.setReplySort('new'));

    expect(mockGetThread.mock.calls.at(-1)![0]).toMatchObject({ offset: 0, sort: 'new' });
    expect(replyIds(result)).toEqual(ids(21, 25));
  });

  it('drops a page that answers after the thread changed', async () => {
    const view = await open(page(ids(1, 10), undefined));
    let release!: (answer: ReturnType<typeof page>) => void;
    mockGetThread.mockImplementationOnce(
      (request) =>
        new Promise<ThreadResult>((resolve) => {
          release = (answer) => resolve(answer(request));
        })
    );
    await act(async () => {
      void view.result.current.loadMoreReplies();
    });

    mockGetThread.mockReturnValueOnce(new Promise(() => {}));
    view.rerender({ id: 'other'.padEnd(64, '0') });
    await act(async () => release(page(ids(11, 12), undefined)));

    expect(replyIds(view.result)).toEqual([]);
  });
});
