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
import type { DmEnvelopePage } from '@/features/payments/data/dmEnvelopeTypes';

const mockFetch = jest.fn();
jest.mock('@/features/payments/data/dmEnvelopeClient', () => ({
  fetchDmEnvelopes: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    paymentLog: sink,
    log: { ...sink, child: () => sink },
    monotonicNow: () => Date.now(),
  };
});

/** The conversation list's page size: a page this long is full. */
const FULL = 100;

/** A page of envelopes, one per id, whose wrap times descend from `newestTs`. */
function page(ids: string[], newestTs = 1_000): DmEnvelopePage {
  return {
    envelopes: ids.map((id, index) => ({
      id,
      createdAt: newestTs - index,
    })) as DmEnvelopePage['envelopes'],
    hasNextPage: false,
  };
}

/** A full page whose ids start with `prefix`. */
function full(prefix: string, newestTs = 1_000): DmEnvelopePage {
  return page(
    Array.from({ length: FULL }, (_, i) => `${prefix}${i}`),
    newestTs
  );
}

function setup({
  fetchPage = jest.fn(async () => full('a')),
  ...overrides
}: Partial<Parameters<typeof useDmEnvelopePages>[0]> & {
  fetchPage?: (args: { until?: number; refresh: boolean }) => Promise<DmEnvelopePage>;
} = {}) {
  mockFetch.mockReset().mockImplementation(fetchPage);
  const onPage = jest.fn();
  const onReset = jest.fn();
  const options = {
    surface: 'dmConversations' as const,
    viewer: 'viewer',
    feedKey: 'viewer',
    hydrate: jest.fn(async () => {}),
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

it('asks the shared inbox for a full page for the viewer', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
  expect(mockFetch).toHaveBeenCalledWith(
    expect.objectContaining({ viewer: 'viewer', limit: FULL, refresh: false })
  );
});

describe('useDmEnvelopePages', () => {
  it('hydrates, loads the first page, and reports more when the page is full', async () => {
    const { result, options, onPage, onReset } = setup();

    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(options.hydrate).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(full('a'), { first: true, mode: 'initial' });
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('keeps paging when a full page lost a wrap that did not parse', async () => {
    const short = { ...page(['a', 'b']), received: FULL };
    const { result } = setup({ fetchPage: jest.fn(async () => short) });
    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(result.current.hasMore).toBe(true);
  });

  it('stops when the backend itself sent a short page', async () => {
    const { result } = setup({ fetchPage: jest.fn(async () => page(['a', 'b'])) });
    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(result.current.hasMore).toBe(false);
  });

  it('reports loading only on a cold start; a snapshot revalidates instead', async () => {
    let finish!: (p: DmEnvelopePage) => void;
    const fetchPage = jest.fn(() => new Promise<DmEnvelopePage>((r) => (finish = r)));
    const cold = setup({ fetchPage });
    expect(cold.result.current.status).toBe('loading');
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    await act(async () => finish(page(['a'])));
    expect(cold.result.current.status).toBe('ready');

    const seeded = setup({ fetchPage, hasSnapshot: true });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(seeded.result.current.status).toBe('revalidating');
    expect(seeded.result.current.hasLoadedOnce).toBe(true);
    await act(async () => finish(page(['a'])));
    expect(seeded.result.current.status).toBe('ready');
  });

  it('pages after the first carry the loadMore mode and never the first flag', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(full('a', 1_000))
      .mockResolvedValueOnce(page(['d'], 900));
    const { result, onPage } = setup({ fetchPage });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });
    expect(onPage).toHaveBeenLastCalledWith(page(['d'], 900), { first: false, mode: 'loadMore' });
  });

  it('pages older envelopes with an `until` cursor behind the oldest wrap time', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(full('a', 1_000))
      .mockResolvedValueOnce(full('d', 900));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    expect(fetchPage.mock.calls[0][0].until).toBeUndefined();

    await act(async () => {
      await result.current.loadMore();
    });

    // Oldest wrap time of page 1 is 901; the cursor over-fetches by its slack.
    expect(fetchPage.mock.calls[1][0].until).toBeGreaterThan(1_000 - FULL + 1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.current.hasMore).toBe(true);
  });

  it('stops paging on a short page', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(full('a', 1_000))
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
    const fetchPage = jest.fn(async () => full('a', 1_000));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('clears accumulated results and reloads when the feed identity changes', async () => {
    const fetchPage = jest.fn(async () => full('a'));
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

  it("drops a failed feed's error once the feed can no longer be loaded", async () => {
    const fetchPage = jest.fn(async () => {
      throw new Error('nagg unavailable');
    });
    const { result, rerender, options } = setup({ fetchPage });
    await waitFor(() => expect(result.current.error?.message).toBe('nagg unavailable'));
    expect(result.current.status).toBe('error');

    rerender({ ...options, feedKey: null });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.error).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('re-fetches the first page with `refresh` set once refresh() is called', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValue(full('a'));
    const { result } = setup({ fetchPage });

    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
    expect(fetchPage.mock.calls[0][0].refresh).toBe(false);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].refresh).toBe(true);
  });

  it('keeps rows on refresh: no reset, status revalidating, first page flagged as a replace', async () => {
    let finish!: (p: DmEnvelopePage) => void;
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(full('a'))
      .mockImplementationOnce(() => new Promise<DmEnvelopePage>((r) => (finish = r)));
    const { result, onPage, onReset } = setup({ fetchPage });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(onReset).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('revalidating');
    expect(result.current.hasLoadedOnce).toBe(true);
    expect(result.current.loading).toBe(false);

    await act(async () => finish(page(['x', 'y'])));
    expect(onPage).toHaveBeenLastCalledWith(page(['x', 'y']), { first: true, mode: 'refresh' });
    expect(result.current.status).toBe('ready');
  });

  it('retains the loaded state when a refresh fails', async () => {
    const fetchPage = jest
      .fn<Promise<DmEnvelopePage>, [{ until?: number; refresh: boolean }]>()
      .mockResolvedValueOnce(full('a'))
      .mockRejectedValueOnce(new Error('nagg unavailable'));
    const { result, onReset } = setup({ fetchPage });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.error?.message).toBe('nagg unavailable'));
    // Rows were never dropped, so this is a degraded-but-populated list, not an error screen.
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
    expect(result.current.hasLoadedOnce).toBe(true);
  });

  it('reports error only when a failure leaves nothing to show', async () => {
    const fetchPage = jest.fn(async () => {
      throw new Error('nagg unavailable');
    });
    const { result } = setup({ fetchPage });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.status).toBe('error');
  });
});
