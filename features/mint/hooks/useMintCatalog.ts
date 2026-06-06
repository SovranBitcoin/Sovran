/**
 * React wrapper around `getMintCatalog`. Surfaces outside the
 * colada flow (currently the Mint Manager) use this to pull the
 * same audit / KYM / operator-profile data the Send / Receive Select Mint
 * screens get through the library callback.
 *
 * Mints not covered by `api.sovran.money`'s audit DB fall back to a direct
 * NUT-06 `getMintInfo` call against the mint, so the operator's Nostr
 * profile still resolves.
 */

import { useEffect, useMemo, useState } from 'react';
import { useManager } from '@cashu/coco-react';
import type { MintCatalogEntry } from '@sovranbitcoin/colada';

import { getMintCatalog } from '@/shared/lib/getMintCatalog';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { getCachedMintInfo } from '@/shared/stores/global/mintInfoCache';

export function useMintCatalog(mintUrls: string[]): Record<string, MintCatalogEntry> {
  const manager = useManager();
  const { isOffline } = useOfflineStatus();
  const [catalog, setCatalog] = useState<Record<string, MintCatalogEntry>>({});

  // Stable key collapses array-identity churn so callers can pass a fresh
  // array reference each render without retriggering the fetch.
  const key = useMemo(() => [...mintUrls].sort().join('|'), [mintUrls]);

  useEffect(() => {
    if (mintUrls.length === 0 || !manager) {
      setCatalog({});
      return;
    }

    let cancelled = false;
    getMintCatalog(mintUrls, (url) => getCachedMintInfo((u) => manager.mint.getMintInfo(u), url), {
      networkMode: isOffline ? 'cache-only' : 'cache-first',
    })
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {
        if (!cancelled) setCatalog({});
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, manager, isOffline]);

  return catalog;
}
