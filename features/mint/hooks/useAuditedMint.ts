import { useState, useEffect } from 'react';

// TODO: re-export GetInfoResponse (or MintInfo alias) from coco-cashu-core
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { auditMint, fetchMintInfo, type AuditMintResponse } from '@/shared/lib/apiClient';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';

// Transform API response to match expected interface structure
interface AuditInfo {
  url: string;
  name: string;
  state: string;
  /** Swap success rate in range [0..1], computed from recent swaps (typically last 100) */
  successRate?: number;
  /** Recent swap window size used for successRate (e.g. 100) */
  swapTotal?: number;
  /** Successful swaps (state === 'OK') in the recent window */
  swapSuccess?: number;
  /** Average time_taken (ms) for successful swaps with time_taken > 0 */
  avgTimeMs?: number;
  /** 0-5 score derived from successRate (swap-based), used by some UI */
  score?: number;
  auditorData: {
    name: string;
    state: string;
    mints: number;
    melts: number;
    errors: number;
  };
}

interface UseAuditedMintResult {
  auditInfo?: AuditInfo;
  mintInfo?: GetInfoResponse;
  loading: boolean;
  error?: string;
}

// Helper function to transform audit data to AuditInfo
const transformAuditData = (auditData: AuditMintResponse): AuditInfo => {
  // Prefer swap-based metrics to match auditor UI (e.g. "100 of 100 swaps")
  const swaps = auditData.swaps || [];
  const swapTotal = swaps.length;
  const swapSuccess = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
  const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
  const score = typeof successRate === 'number' ? successRate * 5 : undefined;

  // Average time in ms for successful swaps
  const successfulTimes = swaps
    .filter((s) => s.state === 'OK' && typeof s.time_taken === 'number' && s.time_taken > 0)
    .map((s) => s.time_taken);
  const avgTimeMs =
    successfulTimes.length > 0
      ? successfulTimes.reduce((sum, t) => sum + t, 0) / successfulTimes.length
      : undefined;

  // Transform to expected interface
  return {
    url: auditData.url,
    name: auditData.name,
    state: auditData.state,
    successRate,
    swapTotal,
    swapSuccess,
    avgTimeMs,
    score,
    auditorData: {
      name: auditData.name,
      state: auditData.state,
      mints: auditData.n_mints,
      melts: auditData.n_melts,
      errors: auditData.n_errors,
    },
  };
};

export const useAuditedMint = (mintUrl?: string): UseAuditedMintResult => {
  const [auditInfo, setAuditInfo] = useState<AuditInfo>();
  const [mintInfo, setMintInfo] = useState<GetInfoResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const getCached = useAuditMintStore((state) => state.getCached);
  const setCached = useAuditMintStore((state) => state.setCached);
  const isStale = useAuditMintStore((state) => state.isStale);

  useEffect(() => {
    if (!mintUrl) {
      setAuditInfo(undefined);
      setMintInfo(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const loadMint = async () => {
      try {
        setLoading(true);
        setError(undefined);

        // Check cache first
        const cached = getCached(mintUrl);
        const stale = isStale(mintUrl);

        if (cached && !stale) {
          // Use cached data
          setAuditInfo(transformAuditData(cached.auditData));
          setMintInfo(cached.mintInfo);
          setLoading(false);
          return;
        }

        // Fetch audit data directly from API
        const auditResult = await auditMint({ mintUrl });
        if (auditResult.isOk()) {
          const auditData = auditResult.value;

          // Transform to expected interface
          const transformedAuditInfo = transformAuditData(auditData);
          setAuditInfo(transformedAuditInfo);
        } else {
          setAuditInfo(undefined);
        }

        // Fetch mint info
        const mintInfoResult = await fetchMintInfo(mintUrl);
        if (mintInfoResult.isOk()) {
          const mintInfoData = mintInfoResult.value;
          setMintInfo(mintInfoData);

          // Cache both audit data and mint info if both succeeded
          if (auditResult.isOk()) {
            setCached(mintUrl, auditResult.value, mintInfoData);
          }
        } else {
          setMintInfo(undefined);
        }
      } catch {
        setError('Failed to load mint information');
        setAuditInfo(undefined);
        setMintInfo(undefined);
      } finally {
        setLoading(false);
      }
    };

    loadMint();
  }, [mintUrl, getCached, setCached, isStale]);

  return { auditInfo, mintInfo, loading, error };
};
