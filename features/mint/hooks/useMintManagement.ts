import { useCallback, useEffect, useState } from 'react';

import type { Mint } from '@cashu/coco-core';
import { useManager } from '@cashu/coco-react';

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
      const allMints = await manager.mint.getAllTrustedMints();
      setMints(allMints);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load mints');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  const addMint = useCallback(
    async (mintUrl: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await manager.mint.trustMint(mintUrl);
        await loadMints();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to add mint');
        setError(error);
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
        return await manager.mint.isTrustedMint(mintUrl);
      } catch {
        return false;
      }
    },
    [manager]
  );

  const getMintInfo = useCallback(
    async (mintUrl: string) => {
      try {
        return await manager.mint.getMintInfo(mintUrl);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to get mint info');
        setError(error);
        throw error;
      }
    },
    [manager]
  );

  const getBalances = useCallback(async () => {
    try {
      return await manager.wallet.getBalances();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to get balances');
      setError(error);
      throw error;
    }
  }, [manager]);

  const restoreMint = useCallback(
    async (mintUrl: string) => {
      setIsLoading(true);
      setError(null);

      try {
        await manager.wallet.restore(mintUrl);
        await loadMints();
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to restore mint');
        setError(error);
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
