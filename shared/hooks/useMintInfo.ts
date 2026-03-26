import { useState, useEffect, useMemo } from 'react';

import type { MintInfo } from '@cashu/cashu-ts';

import { useMintManagement } from '@/features/mint/hooks/useMintManagement';

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
    return match?.mintInfo && Object.keys(match.mintInfo).length > 0
      ? (match.mintInfo as MintInfo)
      : null;
  }, [mintUrl, mints]);

  const [fetchedInfo, setFetchedInfo] = useState<MintInfo | null>(null);

  useEffect(() => {
    if (!mintUrl || cachedInfo) {
      setFetchedInfo(null);
      return;
    }
    let mounted = true;
    getMintInfo(mintUrl)
      .then((info) => {
        if (mounted) setFetchedInfo(info as MintInfo);
      })
      .catch(() => {
        if (mounted) setFetchedInfo(null);
      });
    return () => {
      mounted = false;
    };
  }, [mintUrl, cachedInfo, getMintInfo]);

  return cachedInfo ?? fetchedInfo;
}
