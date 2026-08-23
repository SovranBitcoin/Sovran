/**
 * @jest-environment node
 *
 * Behaviour lock for the paging engine the DM conversation list and a single DM
 * thread now share. The rules under test are the ones that were duplicated
 * (and so could silently drift) before the two hooks were merged onto it: when
 * paging stops, and what a reload clears.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useDmEnvelopePages } from '@/features/payments/hooks/useDmEnvelopePages';
import type { DmEnvelopePage } from '@/features/payments/data/dmEnvelopeClient';

jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const PAGE_LIMIT = 3;

/** A page of `count` envelopes whose wrap times descend from `newestTs`. */
function page(ids: string[], newestTs = 1_000): DmEnvelopePage {
  return {
    envelopes: ids.map((id, index) => ({
      id,
      createdAt: newestTs - index,
    })) as DmEnvelopePage['envelopes'],
    hasNextPage: false,
  };
}

function setup(overrides: Partial<Parameters<typeof useDmEnvelopePages>[0]> = {}) {
  const fetchPage = jest.fn(async () => page(['a', 'b', 'c']));
  const onPage = jest.fn();
  const onReset = jest.fn();
  const options = {
    feedKey: 'viewer',
    pageLimit: PAGE_LIMIT,
    hydrate: jest.fn(async () => {}),
    fetchPage,
    onPage,
    onReset,
    failureEvent: 'test.dm.failed',
    ...overrides,
  };
  const view = renderHook((props: typeof options) => useDmEnvelopePages(props), {
    initialProps: options,
  });
  return { ...view, options, fetchPage, onPage, onReset };
}

describe('useDmEnvelopePages', () => {
  it('hydrates, loads the first page, and reports more when the page is full', async () => {
    const { result, options, onPage, onReset } = setup();

    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(options.hydrate).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(page(['a', 'b', 'c']));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('pages older envelopes with an `until` cursor behind the oldest wrap time', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(page(['a', 'b', 'c'], 1_000))
      .mockResolvedValueOnce(page(['d', 'e', 'f'], 900));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    expect(fetchPage.mock.calls[0][0].until).toBeUndefined();

    await act(async () => {
      await result.current.loadMore();
    });

    // Oldest wrap time of page 1 is 998; the cursor over-fetches by its slack.
    expect(fetchPage.mock.calls[1][0].until).toBeGreaterThan(998);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.current.hasMore).toBe(true);
  });

  it('stops paging on a short page', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(page(['a', 'b', 'c'], 1_000))
      .mockResolvedValueOnce(page(['d'], 900));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.hasMore).toBe(false);
  });

  it('stops paging on a full page the server has already served', async () => {
    // The spinner-forever case: the server ignored `until` and replayed page 1.
    const fetchPage = jest.fn(async () => page(['a', 'b', 'c'], 1_000));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('clears accumulated results and reloads when the feed identity changes', async () => {
    const fetchPage = jest.fn(async () => page(['a', 'b', 'c']));
    const { result, rerender, options, onReset } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(onReset).toHaveBeenCalledTimes(1);

    rerender({ ...options, feedKey: 'other-viewer' });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('clears results without fetching while the feed cannot be loaded', async () => {
    const fetchPage = jest.fn(async () => page(['a']));
    const { result, onReset } = setup({ feedKey: null, fetchPage });

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.hasMore).toBe(false);
  });

  it('surfaces a first-page failure and still settles the first-load latch', async () => {
    const fetchPage = jest.fn(async () => {
      throw new Error('nagg unavailable');
    });
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.error?.message).toBe('nagg unavailable'));
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoadedOnce).toBe(true);
  });

  it('re-fetches the first page with `refresh` set once refresh() is called', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValue(page(['a', 'b', 'c']));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(fetchPage.mock.calls[0][0].refresh).toBe(false);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].refresh).toBe(true);
  });
});
