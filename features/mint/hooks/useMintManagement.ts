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

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

/**
 * Subscribes to the trusted-mints list and re-exposes `getMintInfo` behind
 * loading state. Stays reactive to coco's mint:* events so consumers see
 * mints added or refreshed by recovery / payment flows without re-mounting.
 */
export function useMintManagement() {
  const manager = useManager();
  const [mints, setMints] = useState<Mint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadMints = useCallback(
    async (reason: string = 'manual') => {
      log.debug('mint.list.load.request', { reason, hasInflight: !!inflightLoad });
      setIsLoading(true);

      try {
        // Reuse an in-flight promise if another consumer is already loading.
        let promise = inflightLoad;
        if (promise) {
          log.debug('mint.list.load.join_inflight', { reason });
        } else {
          promise = inflightLoad = (async () => {
            log.debug('mint.list.load.start', { reason });
            try {
              return await manager.mint.getAllTrustedMints();
            } finally {
              inflightLoad = null;
              log.debug('mint.list.load.clear_inflight', { reason });
            }
          })();
        }
        const allMints = await promise;
        setMints(allMints);
        log.info('mint.list.load.success', { reason, count: allMints.length });
      } catch (err) {
        log.error('mint.list.load.error', {
          reason,
          error: err instanceof Error ? err : new Error('Failed to load mints'),
        });
      } finally {
        log.debug('mint.list.load.done', { reason });
        setIsLoading(false);
      }
    },
    [manager]
  );

  const getMintInfo = useCallback(
    async (mintUrl: string) => {
      try {
        log.debug('mint.info.fetch.start', { ...mintUrlLogFields(mintUrl) });
        // SWR through `mintInfoCache`: cached fresh resolves instantly, stale
        // resolves with the prior value and refreshes in the background, miss
        // awaits coco's `getMintInfo` (which itself blocks on HTTP only when
        // its own 5-minute window has expired).
        const info = await getCachedMintInfo((url) => manager.mint.getMintInfo(url), mintUrl);
        log.debug('mint.info.fetch.success', {
          ...mintUrlLogFields(mintUrl),
          hasName: typeof info.name === 'string' && info.name.length > 0,
          hasNuts: !!info.nuts,
        });
        return info;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to get mint info');
        log.error('mint.info.fetch.error', { ...mintUrlLogFields(mintUrl), error });
        throw error;
      }
    },
    [manager]
  );

  useEffect(() => {
    if (!manager) return;
    void loadMints('mount');

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
    const refresh = (reason: string) => {
      log.debug('mint.list.event', { reason });
      void loadMints(reason);
    };
    const onAdded = () => refresh('mint:added');
    const onUpdated = () => refresh('mint:updated');
    const onTrusted = () => refresh('mint:trusted');
    const onUntrusted = () => refresh('mint:untrusted');
    log.debug('mint.list.subscribe');
    manager.on('mint:added', onAdded);
    manager.on('mint:updated', onUpdated);
    manager.on('mint:trusted', onTrusted);
    manager.on('mint:untrusted', onUntrusted);
    return () => {
      log.debug('mint.list.unsubscribe');
      manager.off('mint:added', onAdded);
      manager.off('mint:updated', onUpdated);
      manager.off('mint:trusted', onTrusted);
      manager.off('mint:untrusted', onUntrusted);
    };
  }, [loadMints, manager]);

  return {
    mints,
    isLoading,
    loadMints,
    getMintInfo,
  };
}
