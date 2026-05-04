import { useState, useEffect, useMemo, useRef } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';

import { fetchJson, fetchMintInfo } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey, normalizeUrlForApi } from '@/shared/lib/url';
import { MintListResponse, parseWith } from '@sovranbitcoin/schemas';

import { useMintManagement } from './useMintManagement';

const parseMintList = parseWith(MintListResponse, 'cashu/mints');

interface SovranDiscoveredMintData {
  url: string;
  score: number;
  recommendations: [];
  mintInfo: GetInfoResponse | null;
}

interface UseSovranDiscoveredMintsResult {
  mints: SovranDiscoveredMintData[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const SOVRAN_MINTS_API_URL = 'https://api.sovran.money/api/cashu/mints';

const CONCURRENT_LIMIT = 5;

/**
 * Appends a mint to state if not already present (by normalized URL).
 */
function appendMintIfNew(
  setter: React.Dispatch<React.SetStateAction<SovranDiscoveredMintData[]>>,
  result: SovranDiscoveredMintData
) {
  setter((prev) => {
    const existingUrls = new Set(prev.map((m) => normalizeMintUrlKey(m.url)));
    if (existingUrls.has(normalizeMintUrlKey(result.url))) return prev;
    return [...prev, result];
  });
}

/**
 * Discovers mints via the Sovran API endpoint.
 * Uses normalizeMintUrlKey for URL dedup and filters out already-known mints.
 */
export const useSovranDiscoveredMints = (): UseSovranDiscoveredMintsResult => {
  const [discovered, setDiscovered] = useState<SovranDiscoveredMintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const processedUrls = useRef(new Set<string>());

  const { mints: knownMints } = useMintManagement();

  // Deps intentionally exclude `knownMints` — the Sovran catalogue is
  // refetched only on mount or explicit retry. Trust changes filter the
  // already-fetched list client-side via `mints` below.
  useEffect(() => {
    const controller = new AbortController();
    const fetchMints = async () => {
      try {
        setLoading(true);
        setError(null);
        processedUrls.current.clear();

        const result = await fetchJson(
          SOVRAN_MINTS_API_URL,
          parseMintList,
          'cashu/mints',
          undefined,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (result.isErr()) throw result.error;
        const mintUrls = result.value;
        cashuLog.info('mint.sovran.fetched', { mintCount: mintUrls.length });

        if (mintUrls.length === 0) {
          setDiscovered([]);
          setLoading(false);
          return;
        }

        // Deduplicate by normalized key but keep full URLs for fetching.
        const seenKeys = new Set<string>();
        const urlsToProcess: string[] = [];
        for (const rawUrl of mintUrls) {
          const key = normalizeMintUrlKey(rawUrl);
          if (processedUrls.current.has(key) || seenKeys.has(key)) continue;
          seenKeys.add(key);
          processedUrls.current.add(key);
          urlsToProcess.push(normalizeUrlForApi(rawUrl));
        }

        if (urlsToProcess.length === 0) {
          cashuLog.debug('mint.sovran.noop', { reason: 'all mints already processed' });
          setDiscovered([]);
          setLoading(false);
          return;
        }

        cashuLog.info('mint.sovran.discovered', { newUrls: urlsToProcess.length });

        // Bounded-concurrency worker pool — matches useAuditedMints.ts's
        // CONCURRENT_LIMIT pattern. An unbounded Promise.all on dozens of
        // mints stampedes them simultaneously and blocks the rest of the
        // network behind the handshake fanout.
        let queueIndex = 0;
        let resolved = 0;
        const total = urlsToProcess.length;

        const fetchNext = async (): Promise<void> => {
          if (controller.signal.aborted) return;
          if (queueIndex >= total) return;
          const url = urlsToProcess[queueIndex++]!;
          const base: Omit<SovranDiscoveredMintData, 'mintInfo'> = {
            url,
            score: 0,
            recommendations: [],
          };
          try {
            const mintInfoResult = await fetchMintInfo(url, { signal: controller.signal });
            if (controller.signal.aborted) return;
            const info = mintInfoResult.isOk() ? mintInfoResult.value : null;
            cashuLog.debug('mint.sovran.info.resolved', {
              url,
              hasInfo: !!info,
              hasIcon: !!info?.icon_url,
              name: info?.name,
              progress: `${++resolved}/${total}`,
            });
            appendMintIfNew(setDiscovered, { ...base, mintInfo: info });
          } catch (err) {
            if (controller.signal.aborted) return;
            cashuLog.warn('mint.sovran.info.error', {
              url,
              error: err instanceof Error ? err : new Error(String(err)),
              progress: `${++resolved}/${total}`,
            });
            appendMintIfNew(setDiscovered, { ...base, mintInfo: null });
          }
          await fetchNext();
        };

        const workers = Array.from({ length: Math.min(CONCURRENT_LIMIT, total) }, () =>
          fetchNext()
        );
        await Promise.all(workers);
        if (controller.signal.aborted) return;
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        cashuLog.error('mint.sovran.error', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
        setError(err instanceof Error ? err.message : 'Failed to fetch mints from Sovran API');
        setLoading(false);
      }
    };

    fetchMints();
    return () => controller.abort();
  }, [retryCount]);

  // Filter against the live trusted-mint set on every render so newly
  // trusted mints disappear from the discovery list without a refetch.
  const mints = useMemo(() => {
    const knownKeys = new Set(knownMints.map((m) => normalizeMintUrlKey(m.mintUrl)));
    return discovered.filter((m) => !knownKeys.has(normalizeMintUrlKey(m.url)));
  }, [discovered, knownMints]);

  const retry = () => setRetryCount((prev) => prev + 1);

  return { mints, loading, error, retry };
};
