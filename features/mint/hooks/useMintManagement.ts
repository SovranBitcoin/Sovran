import { useCallback, useEffect, useState } from 'react';

import type { Mint } from '@cashu/coco-core';
import { useManager } from '@cashu/coco-react';
import { log } from '@/shared/lib/logger';

// Module-level in-flight dedupe. Multiple components that use this hook
// (ContactsScreen, settings recovery, mint screens) each kick off their
// own `getAllTrustedMints` on mount. When several of them mount in the
// same tick (boot + tab eager-mount), they used to issue concurrent SQL
// queries for identical data. Sharing the in-flight promise dedupes them
// down to one call; each consumer still gets its own React state, but
// reads from the shared result.
let inflightLoad: Promise<Mint[]> | null = null;

/**
 * Manages the trusted-mints list and common mint operations via the coco Manager.
 *
 * Loads mints on mount, re-exposes `trustMint`, `isTrustedMint`, `getMintInfo`,
 * `getBalances`, and `restore` behind loading/error state.
 */
export function useMintManagement() {
  const manager = useManager();
  const [mints, setMints] = useState<Mint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadMints = useCallback(async () => {
    setIsLoading(true);
    setError(null);

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
      const error = err instanceof Error ? err : new Error('Failed to load mints');
      setError(error);
      log.error('mint.list.load.error', { error });
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  const addMint = useCallback(
    async (mintUrl: string) => {
      setIsLoading(true);
      setError(null);
      log.info('mint.add.start', { mintUrl });

      try {
        const result = await manager.mint.trustMint(mintUrl);
        await loadMints();
        log.info('mint.add.success', { mintUrl });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to add mint');
        setError(error);
        log.error('mint.add.error', { mintUrl, error });
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [manager, loadMints]
  );

  const isKnownMint = useCallback(
    async (mintUrl: string): Promise<boolean> => {
      try {
        const trusted = await manager.mint.isTrustedMint(mintUrl);
        log.debug('mint.trust.check', { mintUrl, trusted });
        return trusted;
      } catch {
        log.warn('mint.trust.check.error', { mintUrl });
        return false;
      }
    },
    [manager]
  );

  const getMintInfo = useCallback(
    async (mintUrl: string) => {
      try {
        const info = await manager.mint.getMintInfo(mintUrl);
        log.debug('mint.info.fetch.success', { mintUrl });
        return info;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to get mint info');
        setError(error);
        log.error('mint.info.fetch.error', { mintUrl, error });
        throw error;
      }
    },
    [manager]
  );

  const getBalances = useCallback(async () => {
    try {
      const byMint = await manager.wallet.balances.byMint();
      log.debug('mint.balances.fetch.success');
      return Object.fromEntries(
        Object.entries(byMint).map(([mintUrl, snapshot]) => [mintUrl, snapshot.total])
      ) as Record<string, number>;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to get balances');
      setError(error);
      log.error('mint.balances.fetch.error', { error });
      throw error;
    }
  }, [manager]);

  const restoreMint = useCallback(
    async (mintUrl: string) => {
      setIsLoading(true);
      setError(null);
      log.info('mint.restore.start', { mintUrl });

      try {
        await manager.wallet.restore(mintUrl);
        await loadMints();
        log.info('mint.restore.success', { mintUrl });
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to restore mint');
        setError(error);
        log.error('mint.restore.error', { mintUrl, error });
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [manager, loadMints]
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

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    mints,

    addMint,
    isKnownMint,
    getMintInfo,
    getBalances,
    restoreMint,
    loadMints,

    isLoading,
    error,

    reset,
  };
}
