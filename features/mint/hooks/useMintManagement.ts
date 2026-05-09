import { useCallback, useEffect, useState } from 'react';

import type { Mint } from '@cashu/coco-core';
import { useManager } from '@cashu/coco-react';
import { log } from '@/shared/lib/logger';
import { getCachedMintInfo } from '@/shared/stores/global/mintInfoCache';

// Module-level in-flight dedupe. Multiple components that use this hook
// (ContactsScreen, settings recovery, mint screens) each kick off their
// own `getAllTrustedMints` on mount. When several of them mount in the
// same tick (boot + tab eager-mount), they used to issue concurrent SQL
// queries for identical data. Sharing the in-flight promise dedupes them
// down to one call; each consumer still gets its own React state, but
// reads from the shared result.
let inflightLoad: Promise<Mint[]> | null = null;

/**
 * Subscribes to the trusted-mints list and re-exposes `getMintInfo` behind
 * loading state. Stays reactive to coco's mint:* events so consumers see
 * mints added or refreshed by recovery / payment flows without re-mounting.
 */
export function useMintManagement() {
  const manager = useManager();
  const [mints, setMints] = useState<Mint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadMints = useCallback(async () => {
    setIsLoading(true);

    try {
      // Reuse an in-flight promise if another consumer is already loading.
      const promise =
        inflightLoad ??
        (inflightLoad = (async () => {
          log.debug('mint.list.load.start');
          try {
            return await manager.mint.getAllTrustedMints();
          } finally {
            inflightLoad = null;
          }
        })());
      const allMints = await promise;
      setMints(allMints);
      log.info('mint.list.load.success', { count: allMints.length });
    } catch (err) {
      log.error('mint.list.load.error', {
        error: err instanceof Error ? err : new Error('Failed to load mints'),
      });
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  const getMintInfo = useCallback(
    async (mintUrl: string) => {
      try {
        // SWR through `mintInfoCache`: cached fresh resolves instantly, stale
        // resolves with the prior value and refreshes in the background, miss
        // awaits coco's `getMintInfo` (which itself blocks on HTTP only when
        // its own 5-minute window has expired).
        const info = await getCachedMintInfo((url) => manager.mint.getMintInfo(url), mintUrl);
        log.debug('mint.info.fetch.success', { mintUrl });
        return info;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to get mint info');
        log.error('mint.info.fetch.error', { mintUrl, error });
        throw error;
      }
    },
    [manager]
  );

  useEffect(() => {
    if (!manager) return;
    loadMints();

    // Stay reactive to mint changes that happen outside this hook —
    // notably during recovery, where the coco patch refreshes mint info
    // (`mint:updated`), creates discovered mints (`mint:added`), and
    // auto-trusts mints that recovered funds (`mint:trusted`). Without
    // this subscription, `mints` is frozen to whatever was loaded on
    // first mount, so consumers like SettingsRecoveryScreen render
    // discovered-with-funds rows with `mint=undefined` (Avatar falls
    // through to the gradient placeholder, which reads as "icon
    // disappeared") and known mints keep stale mintInfo if it was
    // refreshed under them.
    const refresh = () => {
      loadMints();
    };
    manager.on('mint:added', refresh);
    manager.on('mint:updated', refresh);
    manager.on('mint:trusted', refresh);
    manager.on('mint:untrusted', refresh);
    return () => {
      manager.off('mint:added', refresh);
      manager.off('mint:updated', refresh);
      manager.off('mint:trusted', refresh);
      manager.off('mint:untrusted', refresh);
    };
  }, [loadMints, manager]);

  return {
    mints,
    isLoading,
    loadMints,
    getMintInfo,
  };
}
