import { useCallback, useState } from 'react';

import { useManager } from '@cashu/coco-react';

/**
 * Wraps `manager.quotes.createMintQuote` with loading/error state.
 *
 * Provides a single `requestLightningInvoice` action — call it with a
 * mint URL and sat amount to get a Lightning invoice (BOLT11) back.
 */
export function useLightningOperations() {
  const manager = useManager();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const requestLightningInvoice = useCallback(
    async (mintUrl: string, amount: number) => {
      setIsProcessing(true);
      setError(null);

      try {
        return await manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' });
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

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    requestLightningInvoice,
    isProcessing,
    error,
    reset,
  };
}
