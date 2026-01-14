import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { auditMint, fetchMintInfo, type AuditMintResponse } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useAuditMintStore } from 'stores/auditMintStore';

// Transform API response to match expected interface structure
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

// Helper function to transform audit data to AuditInfo
const transformAuditData = (auditData: AuditMintResponse): AuditInfo => {
  // Prefer swap-based metrics to match auditor UI (e.g. "100 of 100 swaps")
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

// Consistent URL normalization across the app
// Only lowercases the domain, preserves path case (e.g., /Bitcoin stays /Bitcoin)
const normalizeUrl = (url: string): string => {
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    // No path, just domain
    return withoutProtocol
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
  return domain + path;
};

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

  // Memoize the joined URL string to use as dependency
  const mintUrlsKey = useMemo(() => mintUrls.join(','), [mintUrls]);

  console.log('[AUDIT_DEBUG] useAuditedMints called with:', {
    mintUrlsCount: mintUrls.length,
    firstFew: mintUrls.slice(0, 3),
  });

  // Load cached data immediately on mount/url change
  useEffect(() => {
    console.log('[AUDIT_DEBUG] useEffect triggered, mintUrls.length:', mintUrls.length);

    if (mintUrls.length === 0) {
      console.log('[AUDIT_DEBUG] No mint URLs, clearing data');
      setData({});
      setLoading(false);
      return;
    }

    const initialData: Record<string, AuditedMintData> = {};
    // Store both normalized key and original URL for API calls
    const urlsToFetch: { normalized: string; original: string }[] = [];

    mintUrls.forEach((url, index) => {
      const normalizedUrl = normalizeUrl(url);
      const cached = getCached(normalizedUrl);
      const stale = isStale(normalizedUrl);

      if (index < 3) {
        console.log(`[AUDIT_DEBUG] Processing URL ${index}:`, {
          original: url,
          normalized: normalizedUrl,
          hasCached: !!cached,
          isStale: stale,
        });
      }

      if (cached && !stale) {
        // Use cached data
        initialData[normalizedUrl] = {
          auditInfo: transformAuditData(cached.auditData),
          mintInfo: cached.mintInfo,
          loading: false,
        };
      } else {
        // Mark for fetching - keep both normalized key and original URL
        initialData[normalizedUrl] = { loading: true };
        urlsToFetch.push({ normalized: normalizedUrl, original: url });
      }
    });

    console.log('[AUDIT_DEBUG] Initial processing complete:', {
      cachedCount: Object.keys(initialData).filter((k) => !initialData[k].loading).length,
      toFetchCount: urlsToFetch.length,
      firstFewToFetch: urlsToFetch.slice(0, 3),
    });

    setData(initialData);

    // If everything was cached, we're done
    if (urlsToFetch.length === 0) {
      console.log('[AUDIT_DEBUG] Everything cached, done loading');
      setLoading(false);
      return;
    }

    // Fetch missing data with concurrency limit
    const CONCURRENT_LIMIT = 5;
    let activeCount = 0;
    let queueIndex = 0;

    const fetchNext = async () => {
      // Check if we've processed all URLs
      if (queueIndex >= urlsToFetch.length) {
        if (activeCount === 0 && mountedRef.current) {
          console.log('[AUDIT_DEBUG] All fetches complete, setting loading false');
          setLoading(false);
        }
        return;
      }

      const { normalized, original } = urlsToFetch[queueIndex++];

      // Skip if already fetching
      if (fetchingRef.current.has(normalized)) {
        console.log('[AUDIT_DEBUG] Already fetching:', normalized);
        fetchNext();
        return;
      }

      fetchingRef.current.add(normalized);
      activeCount++;

      console.log(`[AUDIT_DEBUG] Starting fetch for:`, {
        normalized,
        original,
        queueIndex,
        activeCount,
        mounted: mountedRef.current,
      });

      try {
        let auditInfo: AuditInfo | undefined;
        let mintInfo: GetInfoResponse | undefined;

        // Use original URL for API calls (preserves case and protocol)
        const apiUrl = original.startsWith('http') ? original : `https://${original}`;
        console.log(`[AUDIT_DEBUG] Calling auditMint with apiUrl:`, apiUrl);

        const auditResult = await auditMint({ mintUrl: apiUrl });
        console.log(`[AUDIT_DEBUG] auditMint result for ${normalized}:`, {
          isOk: auditResult.isOk(),
          hasValue: auditResult.isOk() ? !!auditResult.value : false,
          error: auditResult.isErr() ? auditResult.error : null,
          mounted: mountedRef.current,
        });

        if (auditResult.isOk()) {
          auditInfo = transformAuditData(auditResult.value);
          console.log(`[AUDIT_DEBUG] Transformed auditInfo for ${normalized}:`, {
            score: auditInfo.score,
            state: auditInfo.state,
            mints: auditInfo.auditorData.mints,
            melts: auditInfo.auditorData.melts,
            errors: auditInfo.auditorData.errors,
          });
        }

        // Fetch mint info
        console.log(`[AUDIT_DEBUG] Calling fetchMintInfo with apiUrl:`, apiUrl);
        const mintInfoResult = await fetchMintInfo(apiUrl);
        console.log(`[AUDIT_DEBUG] fetchMintInfo result for ${normalized}:`, {
          isOk: mintInfoResult.isOk(),
          hasValue: mintInfoResult.isOk() ? !!mintInfoResult.value : false,
          mounted: mountedRef.current,
        });

        if (mintInfoResult.isOk()) {
          mintInfo = mintInfoResult.value;
        }

        // ALWAYS cache the result in the store (even if component unmounted)
        // This way the next mount will have the data immediately
        if (auditResult.isOk() && mintInfo) {
          console.log(
            `[AUDIT_DEBUG] Caching data for ${normalized} (mounted: ${mountedRef.current})`
          );
          setCached(normalized, auditResult.value, mintInfo);
        }

        // Only update React state if still mounted
        if (mountedRef.current) {
          console.log(`[AUDIT_DEBUG] Setting data for ${normalized}:`, {
            hasAuditInfo: !!auditInfo,
            hasMintInfo: !!mintInfo,
          });
          setData((prev) => ({
            ...prev,
            [normalized]: { auditInfo, mintInfo, loading: false },
          }));
        } else {
          console.log(`[AUDIT_DEBUG] Unmounted, skip state for ${normalized} (cached)`);
        }
      } catch (err) {
        console.log(`[AUDIT_DEBUG] Exception fetching ${normalized}:`, err);
        if (mountedRef.current) {
          setData((prev) => ({
            ...prev,
            [normalized]: { loading: false, error: 'Failed to load' },
          }));
        }
      } finally {
        fetchingRef.current.delete(normalized);
        activeCount--;
        console.log(`[AUDIT_DEBUG] Fetch complete for ${normalized}, activeCount:`, activeCount);
        // Continue fetching next items even if unmounted (they'll be cached)
        fetchNext();
      }
    };

    // Start concurrent fetches
    console.log(
      '[AUDIT_DEBUG] Starting concurrent fetches, limit:',
      Math.min(CONCURRENT_LIMIT, urlsToFetch.length)
    );
    for (let i = 0; i < Math.min(CONCURRENT_LIMIT, urlsToFetch.length); i++) {
      fetchNext();
    }

    // Note: We intentionally don't set mountedRef.current = false here
    // because we want fetches to continue and cache results even if the
    // effect re-runs due to mintUrlsKey changes
  }, [mintUrlsKey, mintUrls, getCached, setCached, isStale]);

  // Track actual component mount/unmount separately
  useEffect(() => {
    console.log('[AUDIT_DEBUG] Component mounted');
    mountedRef.current = true;
    return () => {
      console.log('[AUDIT_DEBUG] Component unmounting');
      mountedRef.current = false;
    };
  }, []);

  const getAuditData = useCallback(
    (mintUrl: string): AuditedMintData => {
      const normalizedUrl = normalizeUrl(mintUrl);
      const result = data[normalizedUrl] || { loading: true };
      console.log(`[AUDIT_DEBUG] getAuditData called:`, {
        mintUrl,
        normalizedUrl,
        found: !!data[normalizedUrl],
        hasAuditInfo: !!result.auditInfo,
        loading: result.loading,
        dataKeys: Object.keys(data).slice(0, 5),
      });
      return result;
    },
    [data]
  );

  console.log('[AUDIT_DEBUG] Hook returning:', {
    dataKeysCount: Object.keys(data).length,
    loading,
    sampleData: Object.entries(data)
      .slice(0, 2)
      .map(([k, v]) => ({
        key: k,
        hasAuditInfo: !!v.auditInfo,
        loading: v.loading,
      })),
  });

  return { data, loading, getAuditData };
};
