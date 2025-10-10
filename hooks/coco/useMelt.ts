import { useManager } from 'coco-cashu-react';
import { useCallback, useState } from 'react';
import type { MeltQuoteResponse } from '@cashu/cashu-ts';

/**
 * Custom hook for Cashu melt operations (paying Lightning invoices)
 * This provides the missing melt functionality for the React module
 */
export function useMelt() {
  const manager = useManager();
  const [isMelting, setIsMelting] = useState(false);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentQuote, setCurrentQuote] = useState<MeltQuoteResponse | null>(null);

  /**
   * Create a melt quote for paying a Lightning invoice
   */
  const createMeltQuote = useCallback(
    async (mintUrl: string, invoice: string): Promise<MeltQuoteResponse> => {
      setIsCreatingQuote(true);
      setError(null);

      try {
        const quote = await manager.quotes.createMeltQuote(mintUrl, invoice);
        setCurrentQuote(quote);
        return quote;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to create melt quote');
        setError(error);
        throw error;
      } finally {
        setIsCreatingQuote(false);
      }
    },
    [manager]
  );

  /**
   * Pay a melt quote (execute the Lightning payment)
   */
  const payMeltQuote = useCallback(
    async (mintUrl: string, quoteId: string): Promise<void> => {
      setIsMelting(true);
      setError(null);

      try {
        await manager.quotes.payMeltQuote(mintUrl, quoteId);
        setCurrentQuote(null); // Clear quote after successful payment
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to pay melt quote');
        setError(error);
        throw error;
      } finally {
        setIsMelting(false);
      }
    },
    [manager]
  );

  /**
   * Create and pay a melt quote in one operation
   */
  const melt = useCallback(
    async (mintUrl: string, invoice: string): Promise<void> => {
      const quote = await createMeltQuote(mintUrl, invoice);
      await payMeltQuote(mintUrl, quote.quote);
    },
    [createMeltQuote, payMeltQuote]
  );

  /**
   * Get a melt quote by ID
   * Note: This is a workaround since getMeltQuote is not exposed in QuotesApi
   * We'll need to access the repository directly through the manager
   */
  const getMeltQuote = useCallback(
    async (mintUrl: string, quoteId: string): Promise<MeltQuoteResponse | null> => {
      setError(null);
      try {
        // Access the melt quote repository directly through the manager
        // This is a workaround since the API doesn't expose getMeltQuote
        const quote = await manager.meltQuoteService.meltQuoteRepo.getMeltQuote(mintUrl, quoteId);
        return quote;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to get melt quote');
        setError(error);
        throw error;
      }
    },
    [manager]
  );

  /**
   * Reset all states
   */
  const reset = useCallback(() => {
    setError(null);
    setCurrentQuote(null);
    setIsMelting(false);
    setIsCreatingQuote(false);
  }, []);

  return {
    // Core operations
    createMeltQuote,
    payMeltQuote,
    getMeltQuote,
    melt, // Combined operation

    // Current state
    currentQuote,

    // Loading states
    isMelting,
    isCreatingQuote,
    isLoading: isMelting || isCreatingQuote,

    // Error handling
    error,

    // Utilities
    reset,
  };
}
