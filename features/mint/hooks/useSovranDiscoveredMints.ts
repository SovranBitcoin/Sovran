import { useState, useEffect, useRef } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';

import { fetchMintInfo } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';

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

        if (!mintUrls || mintUrls.length === 0) {
          setMints([]);
          setLoading(false);
          return;
        }

        const knownMintUrls = new Set(knownMints.map((mint) => normalizeMintUrlKey(mint.mintUrl)));

        const urlsToProcess = mintUrls
          .map((url) => normalizeMintUrlKey(url))
          .filter((url) => {
            if (knownMintUrls.has(url) || processedUrls.current.has(url)) return false;
            processedUrls.current.add(url);
            return true;
          });

        if (urlsToProcess.length === 0) {
          setMints([]);
          setLoading(false);
          return;
        }

        urlsToProcess.forEach(async (url) => {
          const base: Omit<SovranDiscoveredMintData, 'mintInfo'> = {
            url,
            score: 0,
            recommendations: [],
          };

          try {
            const mintInfoResult = await fetchMintInfo(url);
            appendMintIfNew(setMints, {
              ...base,
              mintInfo: mintInfoResult.isOk() ? mintInfoResult.value : null,
            });
          } catch {
            appendMintIfNew(setMints, { ...base, mintInfo: null });
          }
        });

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch mints from Sovran API');
        setLoading(false);
      }
    };

    fetchMints();
  }, [knownMints, retryCount]);

  const retry = () => setRetryCount((prev) => prev + 1);

  return { mints, loading, error, retry };
};
