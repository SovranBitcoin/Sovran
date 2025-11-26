import { useState, useEffect, useRef } from 'react';
import { fetchMintInfo } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useMintManagement } from './useMintManagement';

/**
 * Data structure for Sovran API-discovered mints
 */
export interface SovranDiscoveredMintData {
  url: string;
  score: number; // Default score of 0 (no recommendations from Sovran API)
  recommendations: []; // Empty array (no recommendations from Sovran API)
  mintInfo: GetInfoResponse | null;
}

interface UseSovranDiscoveredMintsResult {
  mints: SovranDiscoveredMintData[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Helper function to normalize URLs for comparison (remove trailing slash)
 */
const normalizeUrl = (url: string): string => {
  return url.replace(/\/$/, '');
};

const SOVRAN_MINTS_API_URL = 'https://api.sovran.money/api/cashu/mints';

/**
 * Hook for discovering mints via Sovran API endpoint
 * Fetches a list of mint URLs and processes them in parallel
 */
export const useSovranDiscoveredMints = (): UseSovranDiscoveredMintsResult => {
  const [mints, setMints] = useState<SovranDiscoveredMintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const processedUrls = useRef(new Set<string>());

  // Get known mints for blacklist
  const { mints: knownMints } = useMintManagement();

  // Fetch mints from Sovran API
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

        // Get known mint URLs for exclusion (normalized)
        const knownMintUrls = new Set(knownMints.map((mint) => normalizeUrl(mint.mintUrl)));

        // Filter out known mints and normalize URLs
        const urlsToProcess = mintUrls
          .map((url) => normalizeUrl(url))
          .filter((url) => {
            const isKnown = knownMintUrls.has(url);
            const alreadyProcessed = processedUrls.current.has(url);
            if (!isKnown && !alreadyProcessed) {
              processedUrls.current.add(url);
              return true;
            }
            return false;
          });

        if (urlsToProcess.length === 0) {
          setMints([]);
          setLoading(false);
          return;
        }

        // Process all URLs in parallel, updating state incrementally as each completes
        urlsToProcess.forEach(async (url) => {
          try {
            const mintInfoResult = await fetchMintInfo(url);
            const result: SovranDiscoveredMintData = {
              url,
              score: 0, // No score from Sovran API
              recommendations: [], // No recommendations from Sovran API
              mintInfo: mintInfoResult.isOk() ? mintInfoResult.value : null,
            };

            // Update state immediately as this mint completes
            setMints((prev) => {
              // Avoid duplicates (in case of race conditions)
              const existingUrls = new Set(prev.map((m) => normalizeUrl(m.url)));
              if (existingUrls.has(normalizeUrl(result.url))) return prev;
              return [...prev, result];
            });
          } catch {
            // Still add the mint even if info fetch fails (with null mintInfo)
            const result: SovranDiscoveredMintData = {
              url,
              score: 0,
              recommendations: [],
              mintInfo: null,
            };
            setMints((prev) => {
              const existingUrls = new Set(prev.map((m) => normalizeUrl(m.url)));
              if (existingUrls.has(normalizeUrl(result.url))) return prev;
              return [...prev, result];
            });
          }
        });

        // Set loading to false after starting all requests
        // (individual mints will update incrementally)
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch mints from Sovran API');
        setLoading(false);
      }
    };

    fetchMints();
  }, [knownMints, retryCount]);

  const retry = () => {
    setRetryCount((prev) => prev + 1);
  };

  return { mints, loading, error, retry };
};
