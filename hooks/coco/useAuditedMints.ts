import { useState, useEffect, useRef, useCallback } from 'react';
import { auditMint, fetchMintInfo, type AuditMintResponse } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useAuditMintStore } from 'stores/auditMintStore';

// Transform API response to match expected interface structure
interface AuditInfo {
  url: string;
  name: string;
  state: string;
  score?: number;
  speedIndex?: number;
  auditorData: {
    name: string;
    state: string;
    mints: number;
    melts: number;
    errors: number;
  };
}

export interface AuditedMintData {
  auditInfo?: AuditInfo;
  mintInfo?: GetInfoResponse;
  loading: boolean;
  error?: string;
}

interface UseAuditedMintsResult {
  data: Record<string, AuditedMintData>;
  loading: boolean;
  getAuditData: (mintUrl: string) => AuditedMintData;
}

// Helper function to transform audit data to AuditInfo
const transformAuditData = (auditData: AuditMintResponse): AuditInfo => {
  const totalOps = auditData.n_mints + auditData.n_melts;
  const successRate = totalOps > 0 ? 1 - auditData.n_errors / totalOps : 1;
  const score = successRate * 5;

  const validSwaps = auditData.swaps.filter((swap) => swap.time_taken > 0);
  const avgSpeed =
    validSwaps.length > 0
      ? validSwaps.reduce((sum, swap) => sum + swap.time_taken, 0) / validSwaps.length / 1000
      : undefined;

  return {
    url: auditData.url,
    name: auditData.name,
    state: auditData.state,
    score,
    speedIndex: avgSpeed,
    auditorData: {
      name: auditData.name,
      state: auditData.state,
      mints: auditData.n_mints,
      melts: auditData.n_melts,
      errors: auditData.n_errors,
    },
  };
};

const normalizeUrl = (url: string): string => url.replace(/\/$/, '');

/**
 * Batch hook for loading audit data for multiple mints at once.
 * Much more efficient than calling useAuditedMint for each individual mint.
 * 
 * Features:
 * - Loads from cache first for instant display
 * - Fetches missing/stale data in batches with concurrency limit
 * - Deduplicates requests
 * - Incremental updates as data loads
 */
export const useAuditedMints = (mintUrls: string[]): UseAuditedMintsResult => {
  const [data, setData] = useState<Record<string, AuditedMintData>>({});
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const getCached = useAuditMintStore((state) => state.getCached);
  const setCached = useAuditMintStore((state) => state.setCached);
  const isStale = useAuditMintStore((state) => state.isStale);

  // Load cached data immediately on mount/url change
  useEffect(() => {
    if (mintUrls.length === 0) {
      setData({});
      setLoading(false);
      return;
    }

    const initialData: Record<string, AuditedMintData> = {};
    const urlsToFetch: string[] = [];

    mintUrls.forEach((url) => {
      const normalizedUrl = normalizeUrl(url);
      const cached = getCached(normalizedUrl);
      const stale = isStale(normalizedUrl);

      if (cached && !stale) {
        // Use cached data
        initialData[normalizedUrl] = {
          auditInfo: transformAuditData(cached.auditData),
          mintInfo: cached.mintInfo,
          loading: false,
        };
      } else {
        // Mark for fetching
        initialData[normalizedUrl] = { loading: true };
        urlsToFetch.push(normalizedUrl);
      }
    });

    setData(initialData);

    // If everything was cached, we're done
    if (urlsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch missing data with concurrency limit
    const CONCURRENT_LIMIT = 5;
    let activeCount = 0;
    let queueIndex = 0;

    const fetchNext = async () => {
      if (!mountedRef.current) return;
      if (queueIndex >= urlsToFetch.length) {
        if (activeCount === 0) {
          setLoading(false);
        }
        return;
      }

      const url = urlsToFetch[queueIndex++];
      
      // Skip if already fetching
      if (fetchingRef.current.has(url)) {
        fetchNext();
        return;
      }

      fetchingRef.current.add(url);
      activeCount++;

      try {
        let auditInfo: AuditInfo | undefined;
        let mintInfo: GetInfoResponse | undefined;

        // Fetch audit data
        const auditResult = await auditMint({ mintUrl: url });
        if (auditResult.isOk()) {
          auditInfo = transformAuditData(auditResult.value);
        }

        // Fetch mint info
        const mintInfoResult = await fetchMintInfo(url);
        if (mintInfoResult.isOk()) {
          mintInfo = mintInfoResult.value;
          
          // Cache if both succeeded
          if (auditResult.isOk()) {
            setCached(url, auditResult.value, mintInfo);
          }
        }

        if (mountedRef.current) {
          setData((prev) => ({
            ...prev,
            [url]: { auditInfo, mintInfo, loading: false },
          }));
        }
      } catch (err) {
        if (mountedRef.current) {
          setData((prev) => ({
            ...prev,
            [url]: { loading: false, error: 'Failed to load' },
          }));
        }
      } finally {
        fetchingRef.current.delete(url);
        activeCount--;
        fetchNext();
      }
    };

    // Start concurrent fetches
    for (let i = 0; i < Math.min(CONCURRENT_LIMIT, urlsToFetch.length); i++) {
      fetchNext();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [mintUrls.join(','), getCached, setCached, isStale]);

  // Reset mounted ref on re-mount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getAuditData = useCallback(
    (mintUrl: string): AuditedMintData => {
      const normalizedUrl = normalizeUrl(mintUrl);
      return data[normalizedUrl] || { loading: true };
    },
    [data]
  );

  return { data, loading, getAuditData };
};

