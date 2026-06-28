import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import { auditMint, fetchMintInfo } from '@/shared/lib/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { cashuLog } from '@/shared/lib/logger';
import { transformAuditData, type AuditInfo } from '../lib/auditInfo';

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

const CONCURRENT_LIMIT = 5;

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

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

  const getCached = useMintMetadataStore((state) => state.getCached);
  const setCached = useMintMetadataStore((state) => state.setAudit);
  const isStale = useMintMetadataStore((state) => state.isStale);

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
      const stale = isStale(normalized, 'audit');

      if (cached?.auditData && !stale) {
        cacheHits++;
        initialData[normalized] = {
          auditInfo: transformAuditData(cached.auditData),
          mintInfo: cached.info,
          loading: false,
        };
      } else {
        initialData[normalized] = { loading: true };
        urlsToFetch.push({ normalized, original: url });
      }
    });
    cashuLog.debug('mint.audit.batch.init', {
      total: mintUrls.length,
      cacheHits,
      toFetch: urlsToFetch.length,
    });

    setData(initialData);

    if (urlsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    // One controller for this batch — aborting on cleanup releases every
    // queued request whose mint hasn't been polled yet, plus whichever
    // requests are mid-flight at the worker concurrency limit.
    const controller = new AbortController();
    let activeCount = 0;
    let queueIndex = 0;

    const fetchNext = async () => {
      if (controller.signal.aborted) return;
      if (queueIndex >= urlsToFetch.length) {
        if (activeCount === 0 && mountedRef.current) {
          setLoading(false);
        }
        return;
      }

      const { normalized, original } = urlsToFetch[queueIndex++]!;

      if (fetchingRef.current.has(normalized)) {
        void fetchNext();
        return;
      }

      fetchingRef.current.add(normalized);
      activeCount++;

      try {
        let auditInfo: AuditInfo | undefined;
        let mintInfo: GetInfoResponse | undefined;

        const apiUrl = original.startsWith('http') ? original : `https://${original}`;

        const auditResult = await auditMint({ mintUrl: apiUrl, signal: controller.signal });
        if (auditResult.isOk()) {
          auditInfo = transformAuditData(auditResult.value);
        }

        const mintInfoResult = await fetchMintInfo(apiUrl, { signal: controller.signal });
        if (mintInfoResult.isOk()) {
          mintInfo = mintInfoResult.value;
        }

        if (auditResult.isOk() && mintInfo) {
          setCached(normalized, auditResult.value, mintInfo);
        }

        cashuLog.debug('mint.audit.fetch.success', {
          ...mintUrlLogFields(normalized),
          hasAudit: !!auditInfo,
          hasMintInfo: !!mintInfo,
        });

        if (mountedRef.current && !controller.signal.aborted) {
          setData((prev) => ({
            ...prev,
            [normalized]: { auditInfo, mintInfo, loading: false },
          }));
        }
      } catch {
        if (controller.signal.aborted) return;
        cashuLog.warn('mint.audit.fetch.error', { ...mintUrlLogFields(normalized) });
        if (mountedRef.current) {
          setData((prev) => ({
            ...prev,
            [normalized]: { loading: false, error: 'Failed to load' },
          }));
        }
      } finally {
        fetchingRef.current.delete(normalized);
        activeCount--;
        void fetchNext();
      }
    };

    for (let i = 0; i < Math.min(CONCURRENT_LIMIT, urlsToFetch.length); i++) {
      void fetchNext();
    }

    return () => controller.abort();
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
