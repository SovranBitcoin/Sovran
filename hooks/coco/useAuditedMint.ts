import { useState, useEffect } from 'react';
import { auditMint, fetchMintInfo } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';

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

export const useAuditedMint = (mintUrl?: string): UseAuditedMintResult => {
  const [auditInfo, setAuditInfo] = useState<AuditInfo>();
  const [mintInfo, setMintInfo] = useState<GetInfoResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

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

        console.log(`🔍 Fetching audit data for mint: ${mintUrl}`);

        // Fetch audit data directly from API
        const auditResult = await auditMint({ mintUrl });
        if (auditResult.isOk()) {
          const auditData = auditResult.value;

          // Calculate success rate (score equivalent)
          const totalOps = auditData.n_mints + auditData.n_melts;
          const successRate = totalOps > 0 ? 1 - auditData.n_errors / totalOps : 1;
          const score = successRate * 5; // Convert to 0-5 scale like KYM

          // Calculate average speed from swaps
          const validSwaps = auditData.swaps.filter((swap) => swap.time_taken > 0);
          const avgSpeed =
            validSwaps.length > 0
              ? validSwaps.reduce((sum, swap) => sum + swap.time_taken, 0) /
              validSwaps.length /
              1000 // Convert to seconds
              : undefined;

          // Transform to expected interface
          const transformedAuditInfo: AuditInfo = {
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

          setAuditInfo(transformedAuditInfo);
          console.log(`✅ Got audit info for ${mintUrl}`);
        } else {
          console.warn(`⚠️ Failed to get audit info for ${mintUrl}:`, auditResult.error.message);
          setAuditInfo(undefined);
        }

        // Fetch mint info
        const mintInfoResult = await fetchMintInfo(mintUrl);
        if (mintInfoResult.isOk()) {
          setMintInfo(mintInfoResult.value);
          console.log(`✅ Got mint info for ${mintUrl}`);
        } else {
          console.warn(`⚠️ Failed to get mint info for ${mintUrl}:`, mintInfoResult.error.message);
          setMintInfo(undefined);
        }
      } catch (err) {
        console.error('❌ Failed to load mint data:', err);
        setError('Failed to load mint information');
        setAuditInfo(undefined);
        setMintInfo(undefined);
      } finally {
        setLoading(false);
      }
    };

    loadMint();
  }, [mintUrl]);

  return { auditInfo, mintInfo, loading, error };
};
