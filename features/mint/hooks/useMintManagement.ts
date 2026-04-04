import { useCallback, useEffect, useState } from 'react';

import type { Mint } from '@cashu/coco-core';
import { useManager } from '@cashu/coco-react';
import { log } from '@/shared/lib/logger';

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
    log.debug('mint.list.load.start');

    try {
      const allMints = await manager.mint.getAllTrustedMints();
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
      const balances = await manager.wallet.getBalances();
      log.debug('mint.balances.fetch.success');
      return balances;
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
    if (manager) {
      loadMints();
    }
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
