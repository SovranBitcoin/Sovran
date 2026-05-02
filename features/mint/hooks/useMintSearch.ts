import { useState, useEffect, useRef } from 'react';

import { searchMints, type MintSearchResult } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';

interface UseMintSearchReturn {
  results: MintSearchResult[];
  loading: boolean;
  error: string | null;
}

/**
 * Server-backed mint search hook.
 *
 * Calls GET /api/cashu/mints/search with optional query and currency filter.
 * Debounces the query by 300ms to avoid excessive API calls during typing.
 * On empty query, fetches the default list (all mints sorted by reliability).
 */
export function useMintSearch(query: string, currency: string): UseMintSearchReturn {
  const [results, setResults] = useState<MintSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchCountRef = useRef(0);

  useEffect(() => {
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
        .then((res) => {
          if (controller.signal.aborted) {
            cashuLog.debug('mint.search.cancelled', {
              fetchId,
              duration_ms: Math.round(performance.now() - t0),
            });
            return;
          }
          const duration = Math.round(performance.now() - t0);
          if (res.isOk()) {
            const withIcons = res.value.results.filter((r) => r.info?.icon_url).length;
            const withReviews = res.value.results.filter((r) => r.review_score !== null).length;
            cashuLog.info('mint.search.results', {
              fetchId,
              query,
              currency,
              count: res.value.results.length,
              total: res.value.total,
              withIcons,
              withReviews,
              duration_ms: duration,
            });
            if (duration > 2000) {
              cashuLog.warn('mint.search.slow', { fetchId, duration_ms: duration, query });
            }
            setResults(res.value.results);
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
  }, [query, currency]);

  return { results, loading, error };
}
