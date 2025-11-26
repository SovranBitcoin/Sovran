import { useState, useEffect } from 'react';
import { auditMint, fetchMintInfo, type AuditMintResponse } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useAuditMintStore } from 'stores/auditMintStore';

// Transform API response to match expected interface structure
interface AuditInfo {
  url: string;
  name: string;
  state: string;
  score?: number; // Calculate from success rate
  speedIndex?: number; // Average speed from swaps
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
  // Calculate success rate (score equivalent)
  const totalOps = auditData.n_mints + auditData.n_melts;
  const successRate = totalOps > 0 ? 1 - auditData.n_errors / totalOps : 1;
  const score = successRate * 5; // Convert to 0-5 scale like KYM

  // Calculate average speed from swaps
  const validSwaps = auditData.swaps.filter((swap) => swap.time_taken > 0);
  const avgSpeed =
    validSwaps.length > 0
      ? validSwaps.reduce((sum, swap) => sum + swap.time_taken, 0) / validSwaps.length / 1000 // Convert to seconds
      : undefined;

  // Transform to expected interface
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
