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
   * Redeem a Lightning invoice after payment
   * This replaces the old checkLightningReceiveStatus function
   */
  const redeemLightningInvoice = useCallback(
    async (mintUrl: string, quoteId: string) => {
      setIsProcessing(true);
      setError(null);

      try {
        await manager.quotes.redeemMintQuote(mintUrl, quoteId);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to redeem mint quote');
        setError(error);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [manager]
  );

  /**
   * Pay a Lightning invoice
   * This replaces the old sendLightning function
   */
  const payLightningInvoice = useCallback(
    async (mintUrl: string, invoice: string) => {
      setIsProcessing(true);
      setError(null);

      try {
        // Create melt quote
        const meltQuote = await manager.quotes.createMeltQuote(mintUrl, invoice);

        // Pay the quote
        await manager.quotes.payMeltQuote(mintUrl, meltQuote.quote);

        return meltQuote;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to pay Lightning invoice');
        setError(error);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [manager]
  );

  /**
   * Wait for a mint quote to be paid (for receiving)
   * This uses Coco's subscription system instead of polling
   */
  const waitForMintQuotePaid = useCallback(
    async (mintUrl: string, quoteId: string) => {
      try {
        return await manager.subscription.awaitMintQuotePaid(mintUrl, quoteId);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to wait for mint quote payment');
        setError(error);
        throw error;
      }
    },
    [manager]
  );

  /**
   * Wait for a melt quote to be paid (for sending)
   */
  const waitForMeltQuotePaid = useCallback(
    async (mintUrl: string, quoteId: string) => {
      try {
        return await manager.subscription.awaitMeltQuotePaid(mintUrl, quoteId);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to wait for melt quote payment');
        setError(error);
        throw error;
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
    redeemLightningInvoice,
    payLightningInvoice,

    // Subscription operations
    waitForMintQuotePaid,
    waitForMeltQuotePaid,

    // State
    isProcessing,
    error,

    // Utilities
    reset,
  };
}
