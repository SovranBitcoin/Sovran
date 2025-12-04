import { useCallback, useRef, useState } from 'react';
import type { MeltQuoteResponse } from '@cashu/cashu-ts';
import type { MeltHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

type MeltStatus = 'idle' | 'creating' | 'paying' | 'success' | 'error';

interface MeltQuoteResult {
  quote: MeltQuoteResponse;
  historyEntry: MeltHistoryEntry;
}

interface MeltOptions {
  onSuccess?: (result: MeltQuoteResult) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

/**
 * Enhanced melt hook that captures the history entry using coco events.
 * This is the coco-idiomatic way to create melt quotes and get the full history entry.
 *
 * Instead of searching through paginated history after creating a quote,
 * this hook listens to the `history:updated` event to capture
 * the MeltHistoryEntry directly when it's created.
 */
export function useMeltWithHistory() {
  const manager = useManager();
  const [status, setStatus] = useState<MeltStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<MeltQuoteResult | null>(null);
  const isProcessingRef = useRef(false);

  /**
   * Create a melt quote and capture the history entry via coco events
   */
  const createMeltQuote = useCallback(
    async (mintUrl: string, invoice: string, opts: MeltOptions = {}): Promise<MeltQuoteResult> => {
      if (isProcessingRef.current) {
        const err = new Error('Melt operation already in progress');
        opts.onError?.(err);
        throw err;
      }

      if (!mintUrl?.trim()) {
        const err = new Error('mintUrl is required');
        opts.onError?.(err);
        throw err;
      }

      if (!invoice?.trim()) {
        const err = new Error('invoice is required');
        opts.onError?.(err);
        throw err;
      }

      isProcessingRef.current = true;
      setStatus('creating');
      setError(null);

      // Collect all melt entries that come through - we'll match by quoteId after
      const capturedMeltEntries: MeltHistoryEntry[] = [];
      let resolveEntryPromise: (entry: MeltHistoryEntry) => void;
      let targetQuoteId: string | null = null;

      const entryPromise = new Promise<MeltHistoryEntry>((resolve) => {
        resolveEntryPromise = resolve;
      });

      // Set up listener for history:updated events (not 'once' - keep listening until we match)
      const handler = ({ entry }: { mintUrl: string; entry: { type: string; quoteId?: string } }) => {
        if (entry.type === 'melt') {
          const meltEntry = entry as MeltHistoryEntry;
          capturedMeltEntries.push(meltEntry);

          // If we already know the target quoteId and this matches, resolve
          if (targetQuoteId && meltEntry.quoteId === targetQuoteId) {
            resolveEntryPromise(meltEntry);
          }
        }
      };

      const unsubscribe = manager.on('history:updated', handler);

      try {
        // Create the melt quote
        const quote = await manager.quotes.createMeltQuote(mintUrl, invoice);
        targetQuoteId = quote.quote;

        // Check if we already captured the entry while creating the quote
        const alreadyCaptured = capturedMeltEntries.find((e) => e.quoteId === quote.quote);
        if (alreadyCaptured) {
          unsubscribe();
          const result = { quote, historyEntry: alreadyCaptured };
          setData(result);
          setStatus('idle');
          opts.onSuccess?.(result);
          return result;
        }

        // Wait for the history entry to be captured
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for history entry')), 5000);
        });

        const historyEntry = await Promise.race([entryPromise, timeoutPromise]);
        unsubscribe();

        const result = { quote, historyEntry };
        setData(result);
        setStatus('idle');
        opts.onSuccess?.(result);
        return result;
      } catch (e) {
        unsubscribe();

        // Last resort: search history directly
        try {
          const history = await manager.history.getPaginatedHistory(0, 20);
          const matchingEntry = history.find(
            (h): h is MeltHistoryEntry =>
              h.type === 'melt' && targetQuoteId !== null && h.quoteId === targetQuoteId
          );

          if (matchingEntry && targetQuoteId) {
            // Get the quote from memory or re-fetch
            const quote = await manager.quotes.createMeltQuote(mintUrl, invoice).catch(() => null);
            if (quote) {
              const result = { quote, historyEntry: matchingEntry };
              setData(result);
              setStatus('idle');
              opts.onSuccess?.(result);
              return result;
            }
          }
        } catch {
          // Ignore fallback errors
        }

        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus('error');
        opts.onError?.(err);
        throw err;
      } finally {
        isProcessingRef.current = false;
        opts.onSettled?.();
      }
    },
    [manager]
  );

  /**
   * Pay a melt quote and track the state change
   */
  const payMeltQuote = useCallback(
    async (mintUrl: string, quoteId: string, opts: MeltOptions = {}): Promise<void> => {
      if (isProcessingRef.current) {
        const err = new Error('Melt operation already in progress');
        opts.onError?.(err);
        throw err;
      }

      isProcessingRef.current = true;
      setStatus('paying');
      setError(null);

      try {
        await manager.quotes.payMeltQuote(mintUrl, quoteId);

        // Update our data with the latest state if we have it
        if (data && data.historyEntry.quoteId === quoteId) {
          setData({
            ...data,
            historyEntry: { ...data.historyEntry, state: 'PAID' },
          });
        }

        setStatus('success');
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus('error');
        opts.onError?.(err);
        throw err;
      } finally {
        isProcessingRef.current = false;
        opts.onSettled?.();
      }
    },
    [manager, data]
  );

  /**
   * Create and pay a melt quote in one operation
   */
  const melt = useCallback(
    async (mintUrl: string, invoice: string, opts: MeltOptions = {}): Promise<MeltQuoteResult> => {
      const result = await createMeltQuote(mintUrl, invoice, opts);
      await payMeltQuote(mintUrl, result.quote.quote, opts);
      return result;
    },
    [createMeltQuote, payMeltQuote]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setData(null);
  }, []);

  return {
    // Core operations
    createMeltQuote,
    payMeltQuote,
    melt,

    // Current state
    data,
    quote: data?.quote ?? null,
    historyEntry: data?.historyEntry ?? null,

    // Status
    status,
    error,
    isCreating: status === 'creating',
    isPaying: status === 'paying',
    isLoading: status === 'creating' || status === 'paying',
    isError: status === 'error',
    isSuccess: status === 'success',

    // Utilities
    reset,
  };
}

