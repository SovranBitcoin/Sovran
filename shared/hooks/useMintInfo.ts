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
export function useMintInfo(mintUrl: string | String | undefined | null): MintInfo | null {
  const { mints, getMintInfo } = useMintManagement();
  // Coerce to primitive string — FormattedString (extends String) breaks === comparisons
  const normalizedUrl = mintUrl ? `${mintUrl}` : null;

  const cachedInfo = useMemo(() => {
    if (!normalizedUrl) return null;
    const match = mints.find((m) => m.mintUrl === normalizedUrl);
    const hit =
      match?.mintInfo && Object.keys(match.mintInfo).length > 0
        ? (match.mintInfo as MintInfo)
        : null;
    if (normalizedUrl) cashuLog.debug('mintInfo.cache', { mintUrl: normalizedUrl, hit: !!hit });
    return hit;
  }, [normalizedUrl, mints]);

  const [fetchedInfo, setFetchedInfo] = useState<MintInfo | null>(null);

  useEffect(() => {
    if (!normalizedUrl || cachedInfo) {
      setFetchedInfo(null);
      return;
    }
    let mounted = true;
    cashuLog.info('mintInfo.fetch.start', { mintUrl: normalizedUrl });
    getMintInfo(normalizedUrl)
      .then((info) => {
        if (mounted) {
          cashuLog.info('mintInfo.fetch.ok', { mintUrl: normalizedUrl, hasInfo: !!info });
          setFetchedInfo(info as MintInfo);
        }
      })
      .catch((err) => {
        cashuLog.warn('mintInfo.fetch.fail', { mintUrl: normalizedUrl, error: err });
        if (mounted) setFetchedInfo(null);
      });
    return () => {
      mounted = false;
    };
  }, [normalizedUrl, cachedInfo, getMintInfo]);

  return cachedInfo ?? fetchedInfo;
}
