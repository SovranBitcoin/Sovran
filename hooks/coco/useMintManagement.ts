import { Mint } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';
import { useCallback, useState, useEffect } from 'react';

/**
 * Custom hook for mint management operations
 * This replaces the mint-related functions in cashuClient.ts
 */
export function useMintManagement() {
  const manager = useManager();
  const [mints, setMints] = useState<Mint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Load all mints from the manager
   */
  const loadMints = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const mints = await manager.mint.getAllTrustedMints();
      console.log('🏦 useMintManagement: Loaded mints from manager:', mints.length);
      console.log(
        '🏦 useMintManagement: Mint URLs:',
        mints.map((m) => m.mintUrl)
      );
      setMints(mints);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load mints');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  /**
   * Add a new mint
   * This replaces the old addMints function
   */
  const addMint = useCallback(
    async (mintUrl: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await manager.mint.trustMint(mintUrl);

        // Reload mints to get the updated list
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

  /**
   * Check if a mint is known
   * This replaces the old isKnownMint function
   */
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

  /**
   * Get mint info
   * This replaces the old getMintInfo function
   */
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

  /**
   * Remove a mint (if supported by the manager)
   * Note: This might not be directly supported by Coco,
   * but we can implement it by clearing proofs and counters
   */
  const removeMint = useCallback(
    async (_mintUrl: string) => {
      setIsLoading(true);
      setError(null);

      try {
        await loadMints();
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to remove mint');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [loadMints]
  );

  /**
   * Get balances for all mints
   * This replaces the old getBalances function
   */
  const getBalances = useCallback(async () => {
    try {
      return await manager.wallet.getBalances();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to get balances');
      setError(error);
      throw error;
    }
  }, [manager]);

  /**
   * Restore a mint from seed
   * This replaces the old restoreMint function
   */
  const restoreMint = useCallback(
    async (mintUrl: string) => {
      setIsLoading(true);
      setError(null);

      try {
        await manager.wallet.restore(mintUrl);

        // Reload mints after restoration
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

  // Load mints on mount
  useEffect(() => {
    if (manager) {
      loadMints();
    } else {
    }
  }, [loadMints, manager]);

  /**
   * Reset error state
   */
  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    // Data
    mints,

    // Operations
    addMint,
    removeMint,
    isKnownMint,
    getMintInfo,
    getBalances,
    restoreMint,
    loadMints,

    // State
    isLoading,
    error,

    // Utilities
    reset,
  };
}
