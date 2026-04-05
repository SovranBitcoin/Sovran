import { useState, useEffect, useRef } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';

import { fetchMintInfo } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey, normalizeUrlForApi } from '@/shared/lib/url';

import { useMintManagement } from './useMintManagement';

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
  const [mints, setMints] = useState<SovranDiscoveredMintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const processedUrls = useRef(new Set<string>());

  const { mints: knownMints } = useMintManagement();

  useEffect(() => {
    const fetchMints = async () => {
      try {
        setLoading(true);
        setError(null);
        processedUrls.current.clear();

        const response = await fetch(SOVRAN_MINTS_API_URL);
        if (!response.ok) {
          throw new Error(`Failed to fetch mints: ${response.statusText}`);
        }

        const mintUrls: string[] = await response.json();
        cashuLog.info('mint.sovran.fetched', { mintCount: mintUrls?.length ?? 0 });

        if (!mintUrls || mintUrls.length === 0) {
          setMints([]);
          setLoading(false);
          return;
        }

        const knownMintUrls = new Set(knownMints.map((mint) => normalizeMintUrlKey(mint.mintUrl)));

        // Deduplicate by normalized key but keep full URLs for fetching
        const seenKeys = new Set<string>();
        const urlsToProcess: string[] = [];
        for (const rawUrl of mintUrls) {
          const key = normalizeMintUrlKey(rawUrl);
          if (knownMintUrls.has(key) || processedUrls.current.has(key) || seenKeys.has(key)) continue;
          seenKeys.add(key);
          processedUrls.current.add(key);
          urlsToProcess.push(normalizeUrlForApi(rawUrl));
        }

        if (urlsToProcess.length === 0) {
          cashuLog.debug('mint.sovran.noop', { reason: 'all mints already known or processed' });
          setMints([]);
          setLoading(false);
          return;
        }

        cashuLog.info('mint.sovran.discovered', { newUrls: urlsToProcess.length });

        let resolved = 0;
        const total = urlsToProcess.length;
        urlsToProcess.forEach(async (url) => {
          const base: Omit<SovranDiscoveredMintData, 'mintInfo'> = {
            url,
            score: 0,
            recommendations: [],
          };

          try {
            const mintInfoResult = await fetchMintInfo(url);
            const info = mintInfoResult.isOk() ? mintInfoResult.value : null;
            cashuLog.debug('mint.sovran.info.resolved', { url, hasInfo: !!info, hasIcon: !!info?.icon_url, name: info?.name, progress: `${++resolved}/${total}` });
            appendMintIfNew(setMints, {
              ...base,
              mintInfo: info,
            });
          } catch (err) {
            cashuLog.warn('mint.sovran.info.error', { url, error: err instanceof Error ? err : new Error(String(err)), progress: `${++resolved}/${total}` });
            appendMintIfNew(setMints, { ...base, mintInfo: null });
          }
        });

        setLoading(false);
      } catch (err) {
        cashuLog.error('mint.sovran.error', { error: err instanceof Error ? err : new Error(String(err)) });
        setError(err instanceof Error ? err.message : 'Failed to fetch mints from Sovran API');
        setLoading(false);
      }
    };

    fetchMints();
  }, [knownMints, retryCount]);

  const retry = () => setRetryCount((prev) => prev + 1);

  return { mints, loading, error, retry };
};
