import { useManager } from 'coco-cashu-react';
import { useCallback, useState } from 'react';

/**
 * Custom hook for Lightning operations (mint quotes, melt quotes)
 * This replaces the complex Lightning functions in cashuClient.ts
 */
export function useLightningOperations() {
  const manager = useManager();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Request a Lightning invoice for receiving funds
   * This replaces the old receiveLightning function
   */
  const requestLightningInvoice = useCallback(
    async (mintUrl: string, amount: number) => {
      setIsProcessing(true);
      setError(null);

      try {
        return await manager.quotes.createMintQuote(mintUrl, amount);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to create mint quote');
        setError(error);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [manager]
  );

  /**
   * Reset error state
   */
  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    // Core operations
    requestLightningInvoice,

    // State
    isProcessing,
    error,

    // Utilities
    reset,
  };
}
