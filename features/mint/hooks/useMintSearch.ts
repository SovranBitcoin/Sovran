import { useState, useEffect, useRef } from 'react';

import { reviewMint, searchMints, type MintSearchResult } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';

interface UseMintSearchReturn {
  results: MintSearchResult[];
  loading: boolean;
  error: string | null;
}

function hasMintIconUrl(result: MintSearchResult): boolean {
  const { info } = result;
  if (typeof info !== 'object' || info === null) return false;
  if (!('icon_url' in info)) return false;

  const iconUrl = (info as { icon_url?: unknown }).icon_url;
  return typeof iconUrl === 'string' && iconUrl.trim().length > 0;
}

const REVIEW_HYDRATION_CONCURRENCY = 8;

async function hydrateReviewFields(
  results: MintSearchResult[],
  signal: AbortSignal
): Promise<MintSearchResult[]> {
  const hydrated: MintSearchResult[] = results.map((result) => ({
    ...result,
    review_score: null,
    review_count: 0,
  }));
  let index = 0;

  const hydrateNext = async (): Promise<void> => {
    if (signal.aborted) return;
    const currentIndex = index++;
    const result = hydrated[currentIndex];
    if (!result) return;

    const reviews = await reviewMint({ mintUrl: result.url, signal }).catch(() => null);
    if (signal.aborted) return;
    if (reviews?.isOk()) {
      hydrated[currentIndex] = {
        ...result,
        review_score: reviews.value.score,
        review_count: reviews.value.recommendations.length,
      };
    }

    await hydrateNext();
  };

  await Promise.all(
    Array.from({ length: Math.min(REVIEW_HYDRATION_CONCURRENCY, hydrated.length) }, () =>
      hydrateNext()
    )
  );

  return hydrated;
}

/**
 * Server-backed mint search hook.
 *
 * Calls GET /api/cashu/mints/search with optional query and currency filter,
 * then hydrates review score/count through the Nagg-backed reviewMint()
 * wrapper. The search API can discover mints; Nagg owns review display data.
 * Debounces the query by 300ms to avoid excessive API calls during typing.
 * On empty query, fetches the default list (all mints sorted by reliability).
 */
export function useMintSearch(
  query: string,
  currency: string,
  options?: { enabled?: boolean }
): UseMintSearchReturn {
  const enabled = options?.enabled ?? true;
  const [results, setResults] = useState<MintSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchCountRef = useRef(0);

  useEffect(() => {
    // Gated off (e.g. query too short to bother the mint search API): clear any
    // prior results and skip the network entirely. An empty query would
    // otherwise fetch the *default* mint catalog, which is wrong for an
    // aggregated search surface.
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Debounce search queries (300ms), but fire immediately for empty/currency-only changes
    const delay = query.trim() ? 300 : 0;

    if (timerRef.current) {
      cashuLog.debug('mint.search.debounce.cancel', { query, delay });
      clearTimeout(timerRef.current);
    }

    if (delay > 0) {
      cashuLog.debug('mint.search.debounce.start', { query, delay });
    }

    // One AbortController per debounced fire — cancelled when the query
    // changes again, the currency flips, or the component unmounts. Means
    // every keystroke in a burst no longer stays in flight after the next
    // keystroke supersedes it.
    const controller = new AbortController();

    timerRef.current = setTimeout(() => {
      const fetchId = ++fetchCountRef.current;
      const t0 = performance.now();
      setLoading(true);
      setError(null);

      cashuLog.info('mint.search.fetch', { fetchId, query, currency });

      searchMints({
        query: query.trim() || undefined,
        currency: currency !== 'ALL' ? currency : undefined,
        fields: 'name,icon_url,description,contact',
        signal: controller.signal,
      })
        .then(async (res) => {
          if (controller.signal.aborted) {
            cashuLog.debug('mint.search.cancelled', {
              fetchId,
              duration_ms: Math.round(performance.now() - t0),
            });
            return;
          }
          const duration = Math.round(performance.now() - t0);
          if (res.isOk()) {
            const results = await hydrateReviewFields(res.value.results, controller.signal);
            if (controller.signal.aborted) return;

            const withIcons = results.filter(hasMintIconUrl).length;
            const withReviews = results.filter((r) => r.review_score !== null).length;
            cashuLog.info('mint.search.results', {
              fetchId,
              query,
              currency,
              count: results.length,
              total: res.value.total,
              withIcons,
              withReviews,
              duration_ms: duration,
            });
            if (duration > 2000) {
              cashuLog.warn('mint.search.slow', { fetchId, duration_ms: duration, query });
            }
            setResults(results);
          } else {
            cashuLog.warn('mint.search.api_error', {
              fetchId,
              query,
              currency,
              duration_ms: duration,
            });
            setError('Failed to search mints');
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          cashuLog.error('mint.search.network_error', {
            fetchId,
            query,
            currency,
            duration_ms: Math.round(performance.now() - t0),
            error: err instanceof Error ? err.message : String(err),
          });
          setError('Failed to search mints');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      controller.abort();
    };
  }, [query, currency, enabled]);

  return { results, loading, error };
}
