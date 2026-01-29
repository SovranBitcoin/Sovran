import { useCallback, useRef, useState } from 'react';
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { MeltHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

type MeltStatus = 'idle' | 'creating' | 'paying' | 'success' | 'error';

/**
 * Type for the prepared melt operation returned by prepareMeltBolt11.
 * We define this inline since PreparedMeltOperation is not exported from coco-cashu-core.
 */
interface PreparedMeltOp {
  id: string;
  quoteId: string;
  amount: number;
  fee_reserve: number;
}

interface MeltQuoteResult {
  quote: MeltQuoteBolt11Response;
  historyEntry: MeltHistoryEntry;
  /** The prepared melt operation ID (used for executeMelt) */
  operationId: string;
}

interface MeltOptions {
  onSuccess?: (result: MeltQuoteResult) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

/**
 * Converts a prepared melt operation to MeltQuoteBolt11Response format for backwards compatibility.
 * The new v3 API uses operations instead of raw quote responses.
 */
function operationToQuote(operation: PreparedMeltOp, invoice: string): MeltQuoteBolt11Response {
  return {
    quote: operation.quoteId,
    amount: operation.amount,
    fee_reserve: operation.fee_reserve,
    state: 'UNPAID' as const,
    expiry: 0, // Not available in operation
    payment_preimage: null,
    change: undefined,
    request: invoice,
    unit: 'sat', // Default to sat, will be updated from history entry if available
  };
}

/**
 * Enhanced melt hook that captures the history entry using coco events.
 * This is the coco-idiomatic way to create melt quotes and get the full history entry.
 *
 * Uses the new v3 two-step melt flow:
 * 1. prepareMeltBolt11() - prepares the operation and reserves proofs
 * 2. executeMelt() - executes the prepared operation
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
   * Prepare a melt operation and capture the history entry via coco events.
   * This is the first step of the two-step melt flow.
   */
  const prepareMeltQuote = useCallback(
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
      const handler = ({
        entry,
      }: {
        mintUrl: string;
        entry: { type: string; quoteId?: string };
      }) => {
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
        // Prepare the melt operation using the new v3 API
        const operation = await manager.quotes.prepareMeltBolt11(mintUrl, invoice);
        targetQuoteId = operation.quoteId;

        // Convert operation to quote format for backwards compatibility
        const quote = operationToQuote(operation, invoice);

        // Check if we already captured the entry while preparing
        const alreadyCaptured = capturedMeltEntries.find((e) => e.quoteId === operation.quoteId);
        if (alreadyCaptured) {
          unsubscribe();
          // Update quote unit from history entry
          quote.unit = alreadyCaptured.unit;
          const result = { quote, historyEntry: alreadyCaptured, operationId: operation.id };
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

        // Update quote unit from history entry
        quote.unit = historyEntry.unit;
        const result = { quote, historyEntry, operationId: operation.id };
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
            // Try to prepare again to get the operation ID
            const operation = await manager.quotes
              .prepareMeltBolt11(mintUrl, invoice)
              .catch(() => null);
            if (operation) {
              const quote = operationToQuote(operation, invoice);
              quote.unit = matchingEntry.unit;
              const result = { quote, historyEntry: matchingEntry, operationId: operation.id };
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
   * Execute a prepared melt operation.
   * This is the second step of the two-step melt flow.
   *
   * @param operationId - The operation ID from prepareMeltQuote
   * @param quoteId - The quote ID (used for backwards compatibility with old API consumers)
   */
  const executeMeltQuote = useCallback(
    async (operationId: string, quoteId: string, opts: MeltOptions = {}): Promise<void> => {
      if (isProcessingRef.current) {
        const err = new Error('Melt operation already in progress');
        opts.onError?.(err);
        throw err;
      }

      isProcessingRef.current = true;
      setStatus('paying');
      setError(null);

      try {
        // Execute the melt operation using the new v3 API
        await manager.quotes.executeMelt(operationId);

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
   * Prepare and execute a melt operation in one call.
   * This is the recommended way to melt when you don't need to show intermediate UI.
   */
  const melt = useCallback(
    async (mintUrl: string, invoice: string, opts: MeltOptions = {}): Promise<MeltQuoteResult> => {
      const result = await prepareMeltQuote(mintUrl, invoice, opts);
      await executeMeltQuote(result.operationId, result.quote.quote, opts);
      return result;
    },
    [prepareMeltQuote, executeMeltQuote]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setData(null);
  }, []);

  return {
    // Core operations
    prepareMeltQuote,
    executeMeltQuote,
    melt,

    // Current state
    data,
    quote: data?.quote ?? null,
    historyEntry: data?.historyEntry ?? null,
    operationId: data?.operationId ?? null,

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
