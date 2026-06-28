import { useEffect, useMemo, useRef, useState } from 'react';

import { discoverMints, type DiscoverMint, type MintSearchResult } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';

interface UseMintSearchReturn {
  results: MintSearchResult[];
  loading: boolean;
  error: string | null;
}

/**
 * Map a nagg discovery row to the screen's MintSearchResult shape. Review score
 * + count come inline (no per-mint fan-out); the operator's Nostr pubkey is
 * surfaced as a NUT-06 `contact` entry so the existing operator-profile path
 * still resolves. Exported for testing.
 */
export function discoverMintToSearchResult(m: DiscoverMint): MintSearchResult {
  const contact = m.operatorPubkey ? [{ method: 'nostr', info: m.operatorPubkey }] : [];
  return {
    url: m.mintUrl,
    name: m.name || m.mintUrl,
    supported_units: m.supportedUnits ?? [],
    state: m.state ?? 'unknown',
    n_mints: m.nMints ?? 0,
    n_melts: m.nMelts ?? 0,
    n_errors: m.nErrors ?? 0,
    review_score: m.averageScore,
    review_count: m.reviewCount,
    info: {
      ...(m.iconUrl ? { icon_url: m.iconUrl } : {}),
      ...(m.description ? { description: m.description } : {}),
      contact,
    },
  };
}

function matchesQuery(result: MintSearchResult, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return result.name.toLowerCase().includes(needle) || result.url.toLowerCase().includes(needle);
}

function matchesCurrency(result: MintSearchResult, currency: string): boolean {
  if (!currency || currency === 'ALL') return true;
  const units = currency
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (units.length === 0) return true;
  return result.supported_units.some((u) => units.includes(u.toLowerCase()));
}

/**
 * Mint discovery hook, backed by nagg's single `/nostr/mint/discover` app-view.
 *
 * One network call returns every mint with audit state, units, review/favourite
 * aggregates and the operator's Vertex reputation — so query + currency
 * filtering happen client-side (instant, no per-keystroke request) and the old
 * api.sovran.money search + per-mint review N+1 fan-out are gone. Inline
 * operator follower/score is seeded into the mint-profile cache so the
 * operator-profile lookup is a cache hit, not another round-trip.
 */
export function useMintSearch(
  query: string,
  currency: string,
  options?: { enabled?: boolean }
): UseMintSearchReturn {
  const enabled = options?.enabled ?? true;
  const [allMints, setAllMints] = useState<MintSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchCountRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setAllMints([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const fetchId = ++fetchCountRef.current;
    const t0 = performance.now();
    setLoading(true);
    setError(null);
    cashuLog.info('mint.discover.fetch', { fetchId });

    discoverMints({ signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const duration = Math.round(performance.now() - t0);
        if (res.isErr()) {
          cashuLog.warn('mint.discover.api_error', { fetchId, duration_ms: duration });
          setError('Failed to load mints');
          return;
        }
        const mapped = res.value.mints.map(discoverMintToSearchResult);
        // Seed the unified cache from the discovery rows so the selector, audit
        // and operator-profile lookups all become cache hits (not round-trips).
        useMintMetadataStore.getState().upsertFromDiscover(res.value.mints);
        cashuLog.info('mint.discover.results', {
          fetchId,
          count: mapped.length,
          withReviews: mapped.filter((r) => r.review_score !== null).length,
          duration_ms: duration,
        });
        setAllMints(mapped);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        cashuLog.error('mint.discover.network_error', {
          fetchId,
          error: err instanceof Error ? err.message : String(err),
        });
        setError('Failed to load mints');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, currency]);

  const results = useMemo(() => {
    const q = query.trim();
    return allMints.filter((m) => matchesQuery(m, q) && matchesCurrency(m, currency));
  }, [allMints, query, currency]);

  return { results, loading, error };
}
