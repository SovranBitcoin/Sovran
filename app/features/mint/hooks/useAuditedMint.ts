import { useState, useEffect } from 'react';

// TODO: re-export GetInfoResponse (or MintInfo alias) from coco-cashu-core
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { auditMint, fetchMintInfo } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { transformAuditData, type AuditInfo } from '../lib/auditInfo';

interface UseAuditedMintResult {
  auditInfo?: AuditInfo;
  mintInfo?: GetInfoResponse;
  loading: boolean;
  error?: string;
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

export const useAuditedMint = (mintUrl?: string): UseAuditedMintResult => {
  const [auditInfo, setAuditInfo] = useState<AuditInfo>();
  const [mintInfo, setMintInfo] = useState<GetInfoResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const getCached = useMintMetadataStore((state) => state.getCached);
  const setCached = useMintMetadataStore((state) => state.setAudit);
  const isStale = useMintMetadataStore((state) => state.isStale);

  useEffect(() => {
    if (!mintUrl) {
      setAuditInfo(undefined);
      setMintInfo(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const controller = new AbortController();
    const loadMint = async () => {
      try {
        setLoading(true);
        setError(undefined);

        // Check cache first
        const cached = getCached(mintUrl);
        const stale = isStale(mintUrl, 'audit');

        if (cached?.auditData && !stale) {
          cashuLog.debug('mint.audit.cache.hit', { ...mintUrlLogFields(mintUrl) });
          setAuditInfo(transformAuditData(cached.auditData));
          setMintInfo(cached.info);
          setLoading(false);
          return;
        }
        cashuLog.debug('mint.audit.cache.miss', { ...mintUrlLogFields(mintUrl) });

        // Fetch audit data directly from API
        cashuLog.info('mint.audit.fetch', { ...mintUrlLogFields(mintUrl) });
        const auditResult = await auditMint({ mintUrl, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (auditResult.isOk()) {
          setAuditInfo(transformAuditData(auditResult.value));
        } else {
          setAuditInfo(undefined);
        }

        // Fetch mint info
        const mintInfoResult = await fetchMintInfo(mintUrl, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (mintInfoResult.isOk()) {
          const mintInfoData = mintInfoResult.value;
          setMintInfo(mintInfoData);

          // Cache both audit data and mint info if both succeeded
          if (auditResult.isOk()) {
            cashuLog.info('mint.audit.complete', {
              ...mintUrlLogFields(mintUrl),
              score: transformAuditData(auditResult.value).score,
            });
            setCached(mintUrl, auditResult.value, mintInfoData);
          }
        } else {
          setMintInfo(undefined);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        cashuLog.error('mint.audit.error', {
          ...mintUrlLogFields(mintUrl),
          error: err instanceof Error ? err : new Error(String(err)),
        });
        setError('Failed to load mint information');
        setAuditInfo(undefined);
        setMintInfo(undefined);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadMint();
    return () => controller.abort();
  }, [mintUrl, getCached, setCached, isStale]);

  return { auditInfo, mintInfo, loading, error };
};
