import { useState, useEffect, useMemo } from 'react';

import type { MintInfo } from '@cashu/cashu-ts';

import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { cashuLog } from '@/shared/lib/logger';

/**
 * Loads mint info for a given mint URL.
 *
 * - Returns cached info instantly from the already-loaded trusted mints list.
 * - Falls back to an async fetch only if the mint isn't in the local list yet.
 * - Does NOT throw on network errors; silently falls back to null.
 */
export function useMintInfo(mintUrl: string | undefined | null): MintInfo | null {
  const { mints, getMintInfo } = useMintManagement();

  const cachedInfo = useMemo(() => {
    if (!mintUrl) return null;
    const match = mints.find((m) => m.mintUrl === mintUrl);
    const hit = match?.mintInfo && Object.keys(match.mintInfo).length > 0
      ? (match.mintInfo as MintInfo)
      : null;
    if (mintUrl) cashuLog.debug('mintInfo.cache', { mintUrl, hit: !!hit });
    return hit;
  }, [mintUrl, mints]);

  const [fetchedInfo, setFetchedInfo] = useState<MintInfo | null>(null);

  useEffect(() => {
    if (!mintUrl || cachedInfo) {
      setFetchedInfo(null);
      return;
    }
    let mounted = true;
    cashuLog.info('mintInfo.fetch.start', { mintUrl });
    getMintInfo(mintUrl)
      .then((info) => {
        if (mounted) {
          cashuLog.info('mintInfo.fetch.ok', { mintUrl, hasInfo: !!info });
          setFetchedInfo(info as MintInfo);
        }
      })
      .catch((err) => {
        cashuLog.warn('mintInfo.fetch.fail', { mintUrl, error: err });
        if (mounted) setFetchedInfo(null);
      });
    return () => {
      mounted = false;
    };
  }, [mintUrl, cachedInfo, getMintInfo]);

  return cachedInfo ?? fetchedInfo;
}
