/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';

import { useManagerContext } from '@cashu/coco-react';

import { useOnchainMeltQuote } from '@/shared/hooks/useOnchainMeltQuote';

jest.mock('@cashu/coco-react', () => ({
  useManagerContext: jest.fn(),
}));

const mockedUseManagerContext = jest.mocked(useManagerContext);

const MINT_URL = 'https://mint.example';
const QUOTE_ID = 'quote-a';
/** Longer than the 12 s poll this hook used to run. */
const POLL_MS = 12_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, reject, resolve };
}

type QuoteListener = (payload: {
  mintUrl: string;
  method: string;
  quoteId: string;
  quote: Record<string, unknown>;
}) => void;

/** Listeners the hook registered on the Coco manager, by event name. */
const listeners = new Map<string, Set<QuoteListener>>();

function emitMeltQuoteUpdated(quoteId: string, quote: Record<string, unknown>): void {
  for (const listener of listeners.get('melt-quote:updated') ?? []) {
    listener({ mintUrl: MINT_URL, method: 'onchain', quoteId, quote: { quoteId, ...quote } });
  }
}

function installRefresh(refresh: jest.Mock): void {
  listeners.clear();
  const on = jest.fn((event: string, listener: QuoteListener) => {
    const set = listeners.get(event) ?? new Set<QuoteListener>();
    set.add(listener);
    listeners.set(event, set);
    return () => set.delete(listener);
  });
  mockedUseManagerContext.mockReturnValue(
    Object.assign(Object.create(null), {
      manager: {
        on,
        quotes: {
          melt: { refresh },
        },
      },
    })
  );
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useOnchainMeltQuote', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('refreshes once on open, then follows Coco instead of polling', async () => {
    const refresh = jest.fn().mockResolvedValue({ state: 'PENDING' });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith({ mintUrl: MINT_URL, quoteId: QUOTE_ID });
    expect(result.current.state).toBe('PENDING');
    expect(listeners.get('melt-quote:updated')?.size).toBe(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 10);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
    expect(listeners.get('melt-quote:updated')?.size).toBe(0);
  });

  it("ignores Coco updates for another quote or another mint", async () => {
    const refresh = jest.fn().mockResolvedValue({ state: 'PENDING' });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();

    await act(async () => {
      emitMeltQuoteUpdated('quote-other', { state: 'PAID' });
      for (const listener of listeners.get('melt-quote:updated') ?? []) {
        listener({
          mintUrl: 'https://other-mint.example',
          method: 'onchain',
          quoteId: QUOTE_ID,
          quote: { state: 'PAID' },
        });
      }
    });
    expect(result.current.state).toBe('PENDING');

    await act(async () => {
      emitMeltQuoteUpdated(QUOTE_ID, { state: 'UNPAID' });
    });
    expect(result.current.state).toBe('UNPAID');

    unmount();
  });

  it("does not count the event its own refresh causes as a second read", async () => {
    // Coco emits melt-quote:updated from inside refresh when the row changes.
    // Counting it would confirm the off-chain verdict without the re-check.
    const refresh = jest.fn(async () => {
      emitMeltQuoteUpdated(QUOTE_ID, { state: 'PAID' });
      return { state: 'PAID' };
    });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();
    expect(result.current.offchainSettled).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.offchainSettled).toBe(true);

    unmount();
  });

  it('does not listen when a settled verdict was already saved', async () => {
    const refresh = jest.fn().mockResolvedValue({ state: 'PAID' });
    installRefresh(refresh);

    const { unmount } = renderHook(() =>
      useOnchainMeltQuote(MINT_URL, QUOTE_ID, {
        persistedOnchainMelt: { settledOffchain: true },
      })
    );
    await flushEffects();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(listeners.get('melt-quote:updated')?.size ?? 0).toBe(0);

    unmount();
  });

  it('shows a quote that settles while the page is open, with its outpoint', async () => {
    const outpoint = `${'b'.repeat(64)}:1`;
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ state: 'PENDING' })
      .mockResolvedValue({ state: 'PAID', outpoint });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();
    expect(result.current.state).toBe('PENDING');

    // Coco's watcher observes the settlement; the page learns it either way.
    await act(async () => {
      emitMeltQuoteUpdated(QUOTE_ID, { state: 'PAID', outpoint });
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(result.current).toMatchObject({ state: 'PAID', outpoint });

    unmount();
  });

  it('stops every future read once a PAID quote includes its outpoint', async () => {
    const refresh = jest.fn().mockResolvedValue({
      outpoint: `${'a'.repeat(64)}:0`,
      state: 'PAID',
    });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();

    expect(result.current.state).toBe('PAID');
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 5);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(listeners.get('melt-quote:updated')?.size).toBe(0);

    unmount();
  });

  it('follows Coco after the opening refresh fails', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('mint offline'));
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();
    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      emitMeltQuoteUpdated(QUOTE_ID, { state: 'PENDING' });
    });
    expect(result.current.state).toBe('PENDING');
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("never shows quote A's settled state as quote B's", async () => {
    // State is claimed for a quote in an effect, one render after the id
    // changes. For that render nothing stored may be exposed: A's PAID and
    // outpoint would be drawn on B's payment.
    const refresh = jest.fn(({ quoteId }: { quoteId: string }) =>
      quoteId === 'quote-a'
        ? Promise.resolve({ state: 'PAID', outpoint: 'aa:0' })
        : new Promise<Record<string, unknown>>(() => undefined)
    );
    installRefresh(refresh);
    const seen: { quoteId: string; state: string | null; outpoint: string | null }[] = [];

    const { rerender, result, unmount } = renderHook(
      ({ quoteId }: { quoteId: string }) => {
        const quote = useOnchainMeltQuote(MINT_URL, quoteId);
        seen.push({ quoteId, state: quote.state, outpoint: quote.outpoint });
        return quote;
      },
      { initialProps: { quoteId: 'quote-a' } }
    );
    await flushEffects();
    expect(result.current).toMatchObject({ state: 'PAID', outpoint: 'aa:0' });

    rerender({ quoteId: 'quote-b' });
    await flushEffects();
    expect(seen.filter((render) => render.quoteId === 'quote-b')).not.toHaveLength(0);
    for (const render of seen.filter((entry) => entry.quoteId === 'quote-b')) {
      expect(render).toMatchObject({ state: null, outpoint: null });
    }

    unmount();
  });

  it('asks again when the read that decides an off-chain verdict fails', async () => {
    // Watching stops on PAID. With no outpoint yet, one follow-up read decides
    // between "no transaction" and "published late"; if it fails and nothing
    // is scheduled, the page waits on a verdict that never comes.
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ state: 'PAID' })
      .mockRejectedValueOnce(new Error('mint unreachable'))
      .mockResolvedValue({ state: 'PAID' });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();
    expect(result.current.offchainSettled).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.offchainSettled).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(result.current.offchainSettled).toBe(true);

    unmount();
  });

  it('stops asking an unreachable mint for the verdict after a few tries', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ state: 'PAID' })
      .mockRejectedValue(new Error('mint unreachable'));
    installRefresh(refresh);

    const { unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60 * 60_000);
    });
    // The first read, the confirm re-check, and six retries of it.
    expect(refresh).toHaveBeenCalledTimes(8);

    unmount();
  });

  it('ignores a late quote A result after the hook switches to quote B', async () => {
    const quoteA = deferred<Record<string, unknown>>();
    const quoteB = deferred<Record<string, unknown>>();
    const refresh = jest.fn(({ quoteId }: { quoteId: string }) =>
      quoteId === 'quote-a' ? quoteA.promise : quoteB.promise
    );
    installRefresh(refresh);

    const { rerender, result, unmount } = renderHook(
      ({ quoteId }: { quoteId: string }) => useOnchainMeltQuote(MINT_URL, quoteId),
      { initialProps: { quoteId: 'quote-a' } }
    );
    expect(refresh).toHaveBeenCalledWith({ mintUrl: MINT_URL, quoteId: 'quote-a' });

    rerender({ quoteId: 'quote-b' });
    expect(refresh).toHaveBeenCalledWith({ mintUrl: MINT_URL, quoteId: 'quote-b' });

    quoteA.resolve({ state: 'PAID' });
    await flushEffects();
    expect(result.current.state).toBeNull();

    quoteB.resolve({ state: 'PENDING' });
    await flushEffects();
    expect(result.current.state).toBe('PENDING');

    unmount();
  });

  it.each([
    { mintUrl: null, quoteId: QUOTE_ID },
    { mintUrl: MINT_URL, quoteId: null },
  ])('clears state and schedules nothing for falsy arguments: %p', async (nextArgs) => {
    const refresh = jest.fn().mockResolvedValue({ state: 'PENDING' });
    installRefresh(refresh);

    const { rerender, result, unmount } = renderHook(
      ({ mintUrl, quoteId }: { mintUrl: string | null; quoteId: string | null }) =>
        useOnchainMeltQuote(mintUrl, quoteId),
      { initialProps: { mintUrl: MINT_URL, quoteId: QUOTE_ID } }
    );
    await flushEffects();
    expect(result.current.state).toBe('PENDING');

    rerender(nextArgs);
    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(false);

    const callsAtClear = refresh.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 5);
    });
    expect(refresh).toHaveBeenCalledTimes(callsAtClear);

    unmount();
  });

  it('suppresses a late state write after unmount', async () => {
    const pending = deferred<Record<string, unknown>>();
    const refresh = jest.fn(() => pending.promise);
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(true);

    unmount();
    pending.resolve({ state: 'PAID' });
    await flushEffects();

    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
