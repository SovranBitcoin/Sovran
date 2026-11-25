/** @jest-environment node */
import { err, ok } from 'neverthrow';
import { createPricelistFeed, POLL_MS } from '@/shared/lib/pricelistFeed';
import {
  ApiHttpError,
  ApiParseError,
  COINBASE_BTC_RATES_URL,
  MEMPOOL_BTC_PRICES_URL,
  fetchBtcRates,
} from '@/shared/lib/apiClient';
import { log } from '@/shared/lib/logger';
import { PRICE_STALE_MINUTES, usePricelistStore } from '@/shared/stores/global/pricelistStore';

// Real signal composition, so the per-provider timeout and the caller's abort
// both reach `fetch` the way they do in the app.
jest.mock('wallet', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    AbortSignal.any(signals.filter((signal): signal is AbortSignal => !!signal)),
  createNostrMintEnrichment: () => ({}),
  isAbortError: (error: Error) => error.name === 'AbortError',
  timeoutSignal: (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('timed out', 'AbortError')), ms);
    return controller.signal;
  },
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
  source: 'coinbase' as const,
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
    expect(log.warn).toHaveBeenCalledWith(
      'pricelist.poll.failed',
      expect.objectContaining({ status: 503 })
    );
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
      feed.stop();
      expect(signal?.aborted).toBe(true);
      onLoading.mockClear();
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

  it('stopping mid-request ends loading', async () => {
    const { feed, fetcher, onLoading } = makeFeed();
    fetcher.mockReturnValue(new Promise(() => {}));
    feed.start();
    await settle();
    expect(onLoading).toHaveBeenLastCalledWith(true);
    feed.stop();
    await settle();
    expect(onLoading).toHaveBeenLastCalledWith(false);
  });

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

  it('writes only a complete snapshot: a partial one keeps the cache and backs off', async () => {
    usePricelistStore.getState().setBtcPrices({ USD: 70_000, EUR: 60_000, GBP: 50_000 });
    const cached = usePricelistStore.getState().pricelist;
    const { feed, fetcher, onPrices } = makeFeed();
    fetcher.mockResolvedValueOnce(ok({ ...payload, rates: { EUR: payload.rates.EUR } }));
    fetcher.mockResolvedValueOnce(ok(payload));
    feed.start();
    await settle();
    expect(onPrices).not.toHaveBeenCalled();
    expect(usePricelistStore.getState().pricelist).toEqual(cached);
    expect(log.warn).toHaveBeenCalledWith(
      'pricelist.poll.failed',
      expect.objectContaining({ status: null })
    );
    // The failure ladder, not the ten-minute poll.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(usePricelistStore.getState().pricelist).toEqual({
      usd: { btc: 77_242 },
      eur: { btc: 67_000 },
      gbp: { btc: 58_000 },
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
  it('fetches Coinbase BTC exchange rates, forwards cancellation and accepts extra envelope fields', async () => {
    const controller = new AbortController();
    const body = {
      data: {
        currency: 'BTC',
        rates: { USD: '77242.5', EUR: '66000', GBP: '58000', ZERO: '0', BAD: 'not-a-number' },
        extraField: true,
      },
    };
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body)));
    const result = await fetchBtcRates({ signal: controller.signal });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.rates.USD?.price).toBe(77242.5);
      expect(result.value.rates.EUR?.price).toBe(66000);
      expect(result.value.rates.GBP?.price).toBe(58000);
      expect(result.value.rates.ZERO).toBeUndefined();
      expect(result.value.rates.BAD).toBeUndefined();
      expect(result.value.updatedAt).toBeGreaterThan(0);
      expect(result.value.source).toBe('coinbase');
    }
    // One fixed public GET: no headers, body or credentials, nothing about the wallet.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(COINBASE_BTC_RATES_URL);
    expect(Object.keys(init ?? {})).toEqual(['signal']);
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it.each(['0', '-1', 'NaN', '', '1e5', ' 77000'])(
    'rejects when all rates are invalid (%p)',
    async (price) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { currency: 'BTC', rates: { USD: price } },
          })
        )
      );
      expect((await fetchBtcRates()).isErr()).toBe(true);
    }
  );

  it('rejects non-BTC base currency', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { currency: 'ETH', rates: { USD: '3000' } },
        })
      )
    );
    expect((await fetchBtcRates()).isErr()).toBe(true);
  });

  it('preserves the status of a real 503 response for retries', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"service unavailable"}', {
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
        new Response(JSON.stringify({ data: { currency: 'BTC', rates: 'leaked-input' } }))
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

// Coinbase first; Mempool.space when Coinbase cannot answer with every fiat
// unit; the cache when neither can. Each provider gets three seconds.
describe('pricelist provider fallback', () => {
  const nowSec = payload.updatedAt;
  const coinbase = (rates: Record<string, string>, currency = 'BTC') =>
    new Response(JSON.stringify({ data: { currency, rates } }));
  const mempool = (body: Record<string, unknown>) => new Response(JSON.stringify(body));
  const MEMPOOL_OK = { time: nowSec - 60, USD: 76_000, EUR: 66_500, GBP: 57_500, JPY: 1 };
  const COINBASE_OK = { USD: '77242.5', EUR: '66000', GBP: '58000' };

  type Route = (url: string, signal: AbortSignal) => Promise<Response>;
  function serve(routes: { coinbase?: Route; mempool?: Route }) {
    return jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const signal = init?.signal as AbortSignal;
      const route = url === COINBASE_BTC_RATES_URL ? routes.coinbase : routes.mempool;
      if (!route) return Promise.reject(new Error(`unexpected ${url}`));
      return route(url, signal);
    });
  }
  // A request that never answers until its signal aborts.
  const hang: Route = (_url, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () =>
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
      );
    });

  it('uses Coinbase and never asks Mempool when Coinbase is complete', async () => {
    const fetch = serve({ coinbase: async () => coinbase(COINBASE_OK) });
    const result = await fetchBtcRates();
    expect(result.isOk() && result.value.source).toBe('coinbase');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a partial response', { USD: '77242.5', EUR: '66000' }],
    ['only unsupported currencies', { CHF: '61000', JPY: '12000000' }],
    ['a non-decimal rate', { ...{ USD: '77242.5', EUR: '66000' }, GBP: 'Infinity' }],
  ])('falls back to Mempool on %s from Coinbase', async (_name, rates) => {
    const fetch = serve({
      coinbase: async () => coinbase(rates),
      mempool: async () => mempool(MEMPOOL_OK),
    });
    const result = await fetchBtcRates();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.source).toBe('mempool');
      expect(result.value.updatedAt).toBe(MEMPOOL_OK.time);
      expect(Object.keys(result.value.rates).sort()).toEqual(['EUR', 'GBP', 'USD']);
      expect(result.value.rates.USD.price).toBe(76_000);
    }
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      COINBASE_BTC_RATES_URL,
      MEMPOOL_BTC_PRICES_URL,
    ]);
    const mempoolInit = fetch.mock.calls[1][1];
    expect(Object.keys(mempoolInit ?? {})).toEqual(['signal']);
  });

  it.each([
    ['an HTTP error', async () => new Response('down', { status: 500 })],
    ['a network failure', async () => Promise.reject(new TypeError('Network request failed'))],
    ['malformed JSON', async () => new Response('{not json')],
  ])('falls back to Mempool on %s from Coinbase', async (_name, coinbaseRoute) => {
    serve({ coinbase: coinbaseRoute, mempool: async () => mempool(MEMPOOL_OK) });
    const result = await fetchBtcRates();
    expect(result.isOk() && result.value.source).toBe('mempool');
  });

  it('gives Coinbase three seconds, then asks Mempool', async () => {
    const fetch = serve({ coinbase: hang, mempool: async () => mempool(MEMPOOL_OK) });
    const pending = fetchBtcRates();
    await jest.advanceTimersByTimeAsync(2_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.isOk() && result.value.source).toBe('mempool');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives Mempool three seconds too', async () => {
    serve({ coinbase: async () => coinbase({}), mempool: hang });
    const pending = fetchBtcRates();
    await jest.advanceTimersByTimeAsync(3_000);
    expect((await pending).isErr()).toBe(true);
  });

  it('stops at Coinbase when the caller aborts: no Mempool request', async () => {
    const controller = new AbortController();
    const fetch = serve({ coinbase: hang, mempool: async () => mempool(MEMPOOL_OK) });
    const pending = fetchBtcRates({ signal: controller.signal });
    await jest.advanceTimersByTimeAsync(500);
    controller.abort();
    const result = await pending;
    expect(result.isErr()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes the caller abort to Mempool as well', async () => {
    const controller = new AbortController();
    serve({ coinbase: async () => coinbase({}), mempool: hang });
    const pending = fetchBtcRates({ signal: controller.signal });
    await jest.advanceTimersByTimeAsync(100);
    controller.abort();
    expect((await pending).isErr()).toBe(true);
  });

  it.each([
    ['older than two hours', { ...MEMPOOL_OK, time: nowSec - 2 * 60 * 60 - 1 }],
    ['more than five minutes ahead', { ...MEMPOOL_OK, time: nowSec + 5 * 60 + 1 }],
    ['not a whole number of seconds', { ...MEMPOOL_OK, time: nowSec - 0.5 }],
    ['missing its time', { USD: 76_000, EUR: 66_500, GBP: 57_500 }],
    ['missing a fiat unit', { time: nowSec, USD: 76_000, EUR: 66_500 }],
    ['a zero price', { ...MEMPOOL_OK, GBP: 0 }],
    ['a string price', { ...MEMPOOL_OK, USD: '76000' }],
  ])('rejects a Mempool snapshot %s', async (_name, body) => {
    serve({ coinbase: async () => coinbase({}), mempool: async () => mempool(body) });
    expect((await fetchBtcRates()).isErr()).toBe(true);
  });

  it('accepts a Mempool time at the edges of the window', async () => {
    for (const time of [nowSec - 2 * 60 * 60, nowSec + 5 * 60]) {
      serve({
        coinbase: async () => coinbase({}),
        mempool: async () => mempool({ ...MEMPOOL_OK, time }),
      });
      const result = await fetchBtcRates();
      expect(result.isOk() && result.value.updatedAt).toBe(time);
      jest.restoreAllMocks();
    }
  });

  it('keeps the last good prices when both providers fail, and backs off', async () => {
    usePricelistStore.getState().setBtcPrices({ USD: 70_000, EUR: 60_000, GBP: 50_000 }, nowSec);
    const cached = usePricelistStore.getState();
    serve({
      coinbase: async () => new Response('down', { status: 503 }),
      mempool: async () => new Response('down', { status: 502 }),
    });
    const { feed, onPrices, onError } = makeFeed(jest.fn(fetchBtcRates));
    feed.start();
    await settle();
    expect(onPrices).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(usePricelistStore.getState().pricelist).toEqual(cached.pricelist);
    expect(usePricelistStore.getState().serverUpdatedAt).toBe(nowSec);
    expect(log.warn).toHaveBeenCalledWith(
      'pricelist.poll.failed',
      expect.objectContaining({ status: 503 })
    );
    feed.stop();
  });

  it('writes a Mempool snapshot to the store with its own time', async () => {
    serve({ coinbase: async () => coinbase({}), mempool: async () => mempool(MEMPOOL_OK) });
    const { feed } = makeFeed(jest.fn(fetchBtcRates));
    feed.start();
    await settle();
    expect(usePricelistStore.getState().pricelist).toEqual({
      usd: { btc: 76_000 },
      eur: { btc: 66_500 },
      gbp: { btc: 57_500 },
    });
    expect(usePricelistStore.getState().serverUpdatedAt).toBe(MEMPOOL_OK.time);
    feed.stop();
  });

  it('never lets an older Mempool snapshot overwrite a fresher cached price', async () => {
    usePricelistStore.getState().setBtcPrices({ USD: 100_000, EUR: 90_000, GBP: 80_000 }, nowSec);
    const cached = usePricelistStore.getState().pricelist;
    serve({
      coinbase: async () => new Response('down', { status: 503 }),
      mempool: async () => mempool({ time: nowSec - 7_000, USD: 80_000, EUR: 70_000, GBP: 60_000 }),
    });
    const { feed, onPrices } = makeFeed(jest.fn(fetchBtcRates));
    feed.start();
    await settle();
    expect(onPrices).not.toHaveBeenCalled();
    expect(usePricelistStore.getState().pricelist).toEqual(cached);
    expect(usePricelistStore.getState().pricelist?.usd?.btc).toBe(100_000);
    expect(usePricelistStore.getState().serverUpdatedAt).toBe(nowSec);
    feed.stop();
  });

  it('takes a Mempool snapshot newer than the cache', async () => {
    usePricelistStore
      .getState()
      .setBtcPrices({ USD: 100_000, EUR: 90_000, GBP: 80_000 }, nowSec - 600);
    serve({ coinbase: async () => coinbase({}), mempool: async () => mempool(MEMPOOL_OK) });
    const { feed } = makeFeed(jest.fn(fetchBtcRates));
    feed.start();
    await settle();
    expect(usePricelistStore.getState().pricelist?.usd?.btc).toBe(76_000);
    expect(usePricelistStore.getState().serverUpdatedAt).toBe(MEMPOOL_OK.time);
    feed.stop();
  });
});

// While the phone is confirmed offline nothing is requested: an in-flight
// request is cancelled (and not counted as a failure) and no timer runs. On
// reconnect a due or failed refresh runs at once; a fresh one waits its turn.
describe('pricelist offline pause', () => {
  it('cancels the in-flight request and schedules nothing while offline', async () => {
    const { feed, fetcher, onLoading } = makeFeed();
    fetcher.mockReturnValue(new Promise(() => {}));
    feed.start();
    await settle();
    const signal = fetcher.mock.calls[0][0]?.signal;
    feed.setOffline(true);
    expect(signal?.aborted).toBe(true);
    expect(onLoading).toHaveBeenLastCalledWith(false);
    expect(jest.getTimerCount()).toBe(0);
    feed.resume('foreground');
    await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it('refreshes at once on reconnect after a failure, keeping the cache meanwhile', async () => {
    usePricelistStore.getState().setBtcPrices({ USD: 70_000, EUR: 60_000, GBP: 50_000 });
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValueOnce(err(new Error('offline')));
    feed.start();
    await settle();
    feed.setOffline(true);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(usePricelistStore.getState().getBtcPrice('usd')).toBe(70_000);
    fetcher.mockResolvedValue(ok(payload));
    feed.setOffline(false);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(usePricelistStore.getState().getBtcPrice('usd')).toBe(77_242);
    // Back on the ten-minute poll.
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    feed.stop();
  });

  it('refreshes at once on reconnect once the last success is due', async () => {
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValue(ok(payload));
    feed.start();
    await settle();
    feed.setOffline(true);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(1);
    feed.setOffline(false);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    feed.stop();
  });

  it('waits out the poll interval on reconnect while the prices are fresh', async () => {
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValue(ok(payload));
    feed.start();
    await settle();
    feed.setOffline(true);
    await jest.advanceTimersByTimeAsync(4 * 60_000);
    feed.setOffline(false);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6 * 60_000 - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    feed.stop();
  });

  it('starts paused when the phone is offline from the outset', async () => {
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValue(ok(payload));
    feed.setOffline(true);
    feed.start();
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(fetcher).not.toHaveBeenCalled();
    feed.setOffline(false);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it('repeated online signals do not add requests', async () => {
    const { feed, fetcher } = makeFeed();
    fetcher.mockResolvedValue(ok(payload));
    feed.start();
    await settle();
    feed.setOffline(false);
    feed.setOffline(false);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    feed.stop();
  });
});
