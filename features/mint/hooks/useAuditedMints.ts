import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import { auditMint, fetchMintInfo, type AuditMintResponse } from '@/shared/lib/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { log } from '@/shared/lib/logger';

interface AuditInfo {
  url: string;
  name: string;
  state: string;
  score?: number;
  /** Swap success rate in range [0..1], computed from recent swaps (typically last 100) */
  successRate?: number;
  /** Recent swap window size used for successRate (e.g. 100) */
  swapTotal?: number;
  /** Successful swaps (state === 'OK') in the recent window */
  swapSuccess?: number;
  /** Average time_taken (ms) for successful swaps with time_taken > 0 */
  avgTimeMs?: number;
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

const transformAuditData = (auditData: AuditMintResponse): AuditInfo => {
  const swaps = auditData.swaps || [];
  const swapTotal = swaps.length;
  const swapSuccess = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
  const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
  const score = typeof successRate === 'number' ? successRate * 5 : undefined;

  const successfulTimes = swaps
    .filter((s) => s.state === 'OK' && typeof s.time_taken === 'number' && s.time_taken > 0)
    .map((s) => s.time_taken);
  const avgTimeMs =
    successfulTimes.length > 0
      ? successfulTimes.reduce((sum, t) => sum + t, 0) / successfulTimes.length
      : undefined;

  return {
    url: auditData.url,
    name: auditData.name,
    state: auditData.state,
    score,
    successRate,
    swapTotal,
    swapSuccess,
    avgTimeMs,
    auditorData: {
      name: auditData.name,
      state: auditData.state,
      mints: auditData.n_mints,
      melts: auditData.n_melts,
      errors: auditData.n_errors,
    },
  };
};

const CONCURRENT_LIMIT = 5;

/**
 * Batch hook for loading audit data for multiple mints at once.
 *
 * - Loads from cache first for instant display
 * - Fetches missing/stale data in batches with concurrency limit
 * - Deduplicates in-flight requests
 * - Caches results in the store even if component unmounts mid-fetch
 */
export const useAuditedMints = (mintUrls: string[]): UseAuditedMintsResult => {
  const [data, setData] = useState<Record<string, AuditedMintData>>({});
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const getCached = useAuditMintStore((state) => state.getCached);
  const setCached = useAuditMintStore((state) => state.setCached);
  const isStale = useAuditMintStore((state) => state.isStale);

  const mintUrlsKey = useMemo(() => mintUrls.join(','), [mintUrls]);

  useEffect(() => {
    if (mintUrls.length === 0) {
      setData({});
      setLoading(false);
      return;
    }

    const initialData: Record<string, AuditedMintData> = {};
    const urlsToFetch: { normalized: string; original: string }[] = [];

    let cacheHits = 0;
    mintUrls.forEach((url) => {
      const normalized = normalizeMintUrlKey(url);
      const cached = getCached(normalized);
      const stale = isStale(normalized);

      if (cached && !stale) {
        cacheHits++;
        initialData[normalized] = {
          auditInfo: transformAuditData(cached.auditData),
          mintInfo: cached.mintInfo,
          loading: false,
        };
      } else {
        initialData[normalized] = { loading: true };
        urlsToFetch.push({ normalized, original: url });
      }
    });
    log.debug('mint.audit.batch.init', {
      total: mintUrls.length,
      cacheHits,
      toFetch: urlsToFetch.length,
    });

    setData(initialData);

    if (urlsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    let activeCount = 0;
    let queueIndex = 0;

    const fetchNext = async () => {
      if (queueIndex >= urlsToFetch.length) {
        if (activeCount === 0 && mountedRef.current) {
          setLoading(false);
        }
        return;
      }

      const { normalized, original } = urlsToFetch[queueIndex++]!;

      if (fetchingRef.current.has(normalized)) {
        fetchNext();
        return;
      }

      fetchingRef.current.add(normalized);
      activeCount++;

      try {
        let auditInfo: AuditInfo | undefined;
        let mintInfo: GetInfoResponse | undefined;

        const apiUrl = original.startsWith('http') ? original : `https://${original}`;

        const auditResult = await auditMint({ mintUrl: apiUrl });
        if (auditResult.isOk()) {
          auditInfo = transformAuditData(auditResult.value);
        }

        const mintInfoResult = await fetchMintInfo(apiUrl);
        if (mintInfoResult.isOk()) {
          mintInfo = mintInfoResult.value;
        }

        if (auditResult.isOk() && mintInfo) {
          setCached(normalized, auditResult.value, mintInfo);
        }

        log.debug('mint.audit.fetch.success', {
          mintUrl: normalized,
          hasAudit: !!auditInfo,
          hasMintInfo: !!mintInfo,
        });

        if (mountedRef.current) {
          setData((prev) => ({
            ...prev,
            [normalized]: { auditInfo, mintInfo, loading: false },
          }));
        }
      } catch {
        log.warn('mint.audit.fetch.error', { mintUrl: normalized });
        if (mountedRef.current) {
          setData((prev) => ({
            ...prev,
            [normalized]: { loading: false, error: 'Failed to load' },
          }));
        }
      } finally {
        fetchingRef.current.delete(normalized);
        activeCount--;
        fetchNext();
      }
    };

    for (let i = 0; i < Math.min(CONCURRENT_LIMIT, urlsToFetch.length); i++) {
      fetchNext();
    }
  }, [mintUrlsKey, mintUrls, getCached, setCached, isStale]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getAuditData = useCallback(
    (mintUrl: string): AuditedMintData => {
      const normalized = normalizeMintUrlKey(mintUrl);
      return data[normalized] || { loading: true };
    },
    [data]
  );

  return { data, loading, getAuditData };
};
