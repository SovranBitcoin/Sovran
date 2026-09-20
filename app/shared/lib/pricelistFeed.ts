/** BTC rates polling, owned outside React so lifecycle teardown cancels all work. */
import { ResultAsync } from 'neverthrow';
import { ApiHttpError, fetchBtcRates } from '@/shared/lib/apiClient';
import { log } from '@/shared/lib/logger';
import { RATE_CODES, type BitcoinPrices } from '@/shared/stores/global/pricelistStore';

export const POLL_MS = 10 * 60 * 1000;
const RESUME_FRESH_MS = 60 * 1000;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];

interface PricelistFeedOptions {
  onPrices: (prices: Partial<BitcoinPrices>, serverUpdatedAtSeconds?: number) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
  fetcher?: typeof fetchBtcRates;
}

export interface PricelistFeed {
  /** Start polling. Repeated calls are a no-op. */
  start: () => void;
  /** Refresh stale data after foreground/connectivity recovery. */
  resume: (reason: 'foreground' | 'online') => void;
  /** Stop permanently, aborting the request and ignoring late completions. */
  stop: () => void;
}

export function createPricelistFeed({
  onPrices,
  onLoading,
  onError,
  fetcher = fetchBtcRates,
}: PricelistFeedOptions): PricelistFeed {
  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let request: AbortController | null = null;
  let lastSuccessAtMs: number | null = null;
  let failures = 0;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delayMs);
  };

  const poll = async () => {
    if (!started || stopped || request) return;
    clearTimer();
    const controller = new AbortController();
    request = controller;
    log.info('pricelist.poll.start');
    onLoading(true);
    // The domain transport returns Result; contain a rejecting injected fetcher too.
    const result = await ResultAsync.fromPromise(
      Promise.resolve().then(() => fetcher({ signal: controller.signal })),
      (error) => (error instanceof Error ? error : new Error('Rates request failed'))
    ).andThen((result) => result);
    if (stopped || controller.signal.aborted) return;
    request = null;

    if (result.isOk()) {
      const { rates, updatedAt, degraded } = result.value;
      const prices: Partial<BitcoinPrices> = {};
      for (const currency of RATE_CODES) {
        if (rates[currency]) prices[currency] = rates[currency].price;
      }
      onPrices(prices, updatedAt);
      onError(null);
      lastSuccessAtMs = Date.now();
      failures = 0;
      log.info('pricelist.poll.ok', {
        updatedAt,
        degraded: degraded ?? false,
        currencies: Object.keys(prices),
      });
      schedule(POLL_MS);
    } else {
      const status = result.error instanceof ApiHttpError ? result.error.status : null;
      log.warn('pricelist.poll.failed', { status });
      // Warming (503) and other background failures retain cached prices without a toast.
      const delayMs = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
      failures = Math.min(failures + 1, RETRY_DELAYS_MS.length);
      // Downward 20% jitter spreads retries while preserving the five-minute cap.
      schedule(Math.round(delayMs * (0.8 + Math.random() * 0.2)));
    }
    onLoading(false);
  };

  return {
    start: () => {
      if (started || stopped) return;
      started = true;
      void poll();
    },
    resume: (reason) => {
      if (!started || stopped || request) return;
      if (lastSuccessAtMs !== null && Date.now() - lastSuccessAtMs <= RESUME_FRESH_MS) return;
      log.info('pricelist.poll.resume', { reason });
      void poll();
    },
    stop: () => {
      stopped = true;
      clearTimer();
      request?.abort();
      request = null;
    },
  };
}
