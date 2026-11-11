import { useState, useEffect, useMemo } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';

import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { cashuLog, mintUrlLogFields } from '@/shared/lib/logger';

/**
 * Loads mint info for a given mint URL.
 *
 * - Returns cached info instantly from the already-loaded trusted mints list.
 * - Falls back to an async fetch only if the mint isn't in the local list yet.
 * - Does NOT throw on network errors; silently falls back to null.
 */
export function useMintInfo(mintUrl: string | undefined | null): GetInfoResponse | null {
  const { mints, getMintInfo } = useMintManagement();
  // Coerce to primitive string — FormattedString (extends String) breaks === comparisons
  const normalizedUrl = mintUrl ? `${mintUrl}` : null;

  const cachedInfo = useMemo(() => {
    if (!normalizedUrl) return null;
    const match = mints.find((m) => m.mintUrl === normalizedUrl);
    const hit = match?.mintInfo && Object.keys(match.mintInfo).length > 0 ? match.mintInfo : null;
    cashuLog.debug('mintInfo.cache', { ...mintUrlLogFields(normalizedUrl), hit: !!hit });
    return hit;
  }, [normalizedUrl, mints]);

  // Keyed by the URL it was fetched for, so another mint's info never stands in.
  const [fetched, setFetched] = useState<{ url: string; info: GetInfoResponse | null } | null>(
    null
  );

  useEffect(() => {
    if (!normalizedUrl || cachedInfo) {
      setFetched(null);
      return;
    }
    let mounted = true;
    cashuLog.info('mintInfo.fetch.start', { ...mintUrlLogFields(normalizedUrl) });
    getMintInfo(normalizedUrl)
      .then((info) => {
        if (mounted) {
          cashuLog.info('mintInfo.fetch.ok', {
            ...mintUrlLogFields(normalizedUrl),
            hasInfo: !!info,
          });
          setFetched({ url: normalizedUrl, info });
        }
      })
      .catch((err) => {
        cashuLog.warn('mintInfo.fetch.fail', { ...mintUrlLogFields(normalizedUrl), error: err });
        if (mounted) setFetched(null);
      });
    return () => {
      mounted = false;
    };
  }, [normalizedUrl, cachedInfo, getMintInfo]);

  return cachedInfo ?? (fetched?.url === normalizedUrl ? fetched.info : null);
}
