/** @jest-environment node */
import { err, ok } from 'neverthrow';
import { createPricelistFeed, POLL_MS } from '@/shared/lib/pricelistFeed';
import { ApiHttpError, ApiParseError, fetchBtcRates } from '@/shared/lib/apiClient';
import { log } from '@/shared/lib/logger';
import { PRICE_STALE_MINUTES, usePricelistStore } from '@/shared/stores/global/pricelistStore';

jest.mock('wallet', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) => signals.find((signal) => !!signal),
  createNostrMintEnrichment: () => ({}),
  isAbortError: (error: Error) => error.name === 'AbortError',
  timeoutSignal: () => new AbortController().signal,
}));
jest.mock('@/shared/config/backend', () => ({
  backendConfig: { scoreApiBaseUrl: 'https://rates.example.test' },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn() },
  apiLog: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

type Rates = Awaited<ReturnType<typeof fetchBtcRates>>;
const payload = {
  updatedAt: 1_800_000_000,
  degraded: false,
  rates: {
    USD: { price: 77_242, at: 1_800_000_000 },
    EUR: { price: 67_000, at: 1_800_000_000 },
    GBP: { price: 58_000, at: 1_800_000_000 },
    CHF: { price: 61_000, at: 1_800_000_000 },
  },
};

function makeFeed(
  fetcher = jest.fn<ReturnType<typeof fetchBtcRates>, Parameters<typeof fetchBtcRates>>()
) {
  const onPrices = jest.fn(usePricelistStore.getState().setBtcPrices);
  const onLoading = jest.fn();
  const onError = jest.fn();
  const feed = createPricelistFeed({ onPrices, onLoading, onError, fetcher });
  return { feed, fetcher, onPrices, onLoading, onError };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(payload.updatedAt * 1000);
  jest.spyOn(Math, 'random').mockReturnValue(1);
  usePricelistStore.setState(usePricelistStore.getInitialState());
});
afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Drain promise continuations without advancing to the next scheduled poll.
const settle = () => jest.advanceTimersByTimeAsync(0);

describe('pricelist polling', () => {
  it('starts once, maps supported prices and timestamp, and polls every ten minutes', async () => {
    const { feed, fetcher, onPrices, onLoading, onError } = makeFeed();
    fetcher.mockResolvedValue(ok(payload));
    feed.resume('online');
    expect(fetcher).not.toHaveBeenCalled();
    feed.start();
    feed.start();
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onPrices).toHaveBeenCalledWith(
      { USD: 77_242, EUR: 67_000, GBP: 58_000 },
      payload.updatedAt
    );
    expect(onLoading.mock.calls).toEqual([[true], [false]]);
    expect(onError).toHaveBeenLastCalledWith(null);
    await jest.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    feed.stop();
  });

  it.each(['foreground', 'online'] as const)(
    'debounces %s until success is older than 60s',
    async (reason) => {
      const { feed, fetcher } = makeFeed();
      fetcher.mockResolvedValue(ok(payload));
      feed.start();
      await settle();
      await jest.advanceTimersByTimeAsync(60_000);
      feed.resume(reason);
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      feed.resume(reason);
      feed.resume(reason);
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(2);
      // Resume replaces the old poll timer.
      await jest.advanceTimersByTimeAsync(POLL_MS - 1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(3);
      feed.stop();
    }
  );

  it('retries 503 warming at 30s, 1m, 2m, then 5m capped, without an error toast', async () => {
    const { feed, fetcher, onPrices, onError } = makeFeed();
    fetcher.mockResolvedValue(err(new ApiHttpError(503, 'Service Unavailable')));
    feed.start();
    await settle();
    let calls = 1;
    for (const delayMs of [30_000, 60_000, 120_000, 300_000, 300_000]) {
      await jest.advanceTimersByTimeAsync(delayMs - 1);
      expect(fetcher).toHaveBeenCalledTimes(calls);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(++calls);
    }
    expect(onPrices).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('pricelist.poll.failed', { status: 503 });
    feed.stop();
  });

  it('jitters retries and resets the failure ladder after success', async () => {
    jest.mocked(Math.random).mockReturnValue(0);
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValue(err(new Error('offline')));
    feed.start();
    await settle();
    await jest.advanceTimersByTimeAsync(24_000 - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(ok(payload));
    await jest.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(24_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    feed.stop();
  });

  it('resumes immediately during backoff and contains rejected fetchers', async () => {
    const { feed, fetcher } = makeFeed();
    fetcher.mockRejectedValue(new Error('offline'));
    feed.start();
    await settle();
    fetcher.mockResolvedValue(ok(payload));
    feed.resume('online');
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    feed.stop();
  });

  it.each([true, false])(
    'aborts in-flight work and ignores late completion (success=%s)',
    async (success) => {
      let complete!: (result: Rates) => void;
      const { feed, fetcher, onPrices, onLoading, onError } = makeFeed();
      fetcher.mockReturnValue(
        new Promise((resolve) => {
          complete = resolve;
        })
      );
      feed.start();
      await settle();
      feed.resume('online');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const signal = fetcher.mock.calls[0][0]?.signal;
      onLoading.mockClear();
      feed.stop();
      expect(signal?.aborted).toBe(true);
      complete(success ? ok(payload) : err(new Error('late failure')));
      await settle();
      feed.resume('foreground');
      feed.start();
      expect(onPrices).not.toHaveBeenCalled();
      expect(onLoading).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it.each([true, false])('clears scheduled work on stop (success=%s)', async (success) => {
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValue(success ? ok(payload) : err(new Error('offline')));
    feed.start();
    await settle();
    feed.stop();
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves cached currencies omitted on the first and subsequent responses', async () => {
    usePricelistStore.getState().setBtcPrices({ USD: 70_000, EUR: 60_000, GBP: 50_000 });
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValueOnce(ok({ ...payload, rates: { EUR: payload.rates.EUR } }));
    fetcher.mockResolvedValueOnce(ok({ ...payload, rates: { USD: payload.rates.USD } }));
    feed.start();
    await settle();
    expect(usePricelistStore.getState().pricelist).toEqual({
      usd: { btc: 70_000 },
      eur: { btc: 67_000 },
      gbp: { btc: 50_000 },
    });
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(usePricelistStore.getState().pricelist).toEqual({
      usd: { btc: 77_242 },
      eur: { btc: 67_000 },
      gbp: { btc: 50_000 },
    });
    expect(usePricelistStore.getState().serverUpdatedAt).toBe(payload.updatedAt);
    feed.stop();
  });

  it('does not invent an absent currency or refresh the store for an empty rates map', () => {
    usePricelistStore.getState().setBtcPrices({ EUR: 67_000 }, payload.updatedAt);
    expect(usePricelistStore.getState().getBtcPrice('usd')).toBeNull();
    expect(usePricelistStore.getState().pricelist).toEqual({ eur: { btc: 67_000 } });
    const previous = usePricelistStore.getState();
    usePricelistStore.getState().setBtcPrices({}, payload.updatedAt + 60);
    expect(usePricelistStore.getState()).toBe(previous);
  });

  it('uses the hourly server age for staleness, with local time for legacy writes', () => {
    const { setBtcPrices, isStale } = usePricelistStore.getState();
    expect(isStale()).toBe(true);
    setBtcPrices({ USD: 70_000 }, payload.updatedAt - PRICE_STALE_MINUTES * 60);
    expect(isStale()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(isStale()).toBe(true);
    setBtcPrices({ USD: 71_000 }, payload.updatedAt - PRICE_STALE_MINUTES * 60);
    expect(isStale()).toBe(true);
    setBtcPrices({ USD: 72_000 });
    expect(isStale()).toBe(false);
    expect(usePricelistStore.getState().serverUpdatedAt).toBeNull();
  });
});

describe('pricelist HTTP boundary', () => {
  it('uses the configured rates endpoint, forwards cancellation and accepts extra envelope fields', async () => {
    const controller = new AbortController();
    const body = { ...payload, version: 1, base: 'BTC', sources: [] };
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body)));
    const result = await fetchBtcRates({ signal: controller.signal });
    expect(result).toEqual(ok(body));
    expect(fetch).toHaveBeenCalledWith('https://rates.example.test/app/rates', {
      signal: controller.signal,
    });
  });

  it.each([0, -1, '77242', null])('rejects invalid prices (%s)', async (price) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ...payload,
          rates: { USD: { price, at: payload.updatedAt } },
        })
      )
    );
    expect((await fetchBtcRates()).isErr()).toBe(true);
  });

  it('preserves the status of a real 503 warming response for retries', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"rates warming"}', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    );
    const result = await fetchBtcRates();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ApiHttpError);
      expect(result.error).toMatchObject({ status: 503 });
    }
  });

  it('types a schema failure so callers can tell it from a transport failure', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ...payload, rates: { USD: { price: 'leaked-input' } } }))
      );
    const result = await fetchBtcRates();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ApiParseError);
      expect(JSON.stringify(result.error)).not.toContain('leaked-input');
      expect(result.error.cause).toBeUndefined();
    }
  });
});
