import { useCallback, useRef, useState } from 'react';

import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { MeltHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

type MeltStatus = 'idle' | 'creating' | 'paying' | 'success' | 'error';

/**
 * Subset of coco's PreparedMeltOperation used to build UI-facing quote/history data.
 *
 * COCO EXCEPTION: PreparedMeltOperation is not exported from coco-cashu-core's
 * public API (operations/index.ts cherry-picks only MeltOperationService).
 * Flag for extraction into coco's public exports.
 */
interface PreparedMeltOp {
  id: string;
  quoteId: string;
  amount: number;
  fee_reserve: number;
  mintUrl: string;
}

interface MeltQuoteResult {
  quote: MeltQuoteBolt11Response;
  historyEntry: MeltHistoryEntry;
  operationId: string;
}

interface MeltOptions {
  onSuccess?: (result: MeltQuoteResult) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

/**
 * COCO EXCEPTION: MeltQuoteBolt11Response is not re-exported from coco-cashu-core.
 * This shim builds one from the prepared operation so downstream screens
 * (MeltQuoteScreen) can render quote details.
 */
function operationToQuote(operation: PreparedMeltOp, invoice: string): MeltQuoteBolt11Response {
  return {
    quote: operation.quoteId,
    amount: operation.amount,
    fee_reserve: operation.fee_reserve,
    state: 'UNPAID' as const,
    expiry: 0,
    payment_preimage: null,
    change: undefined,
    request: invoice,
    unit: 'sat',
  };
}

/**
 * Builds a MeltHistoryEntry from a prepared operation.
 * The v3 prepareMeltBolt11 flow does not create history entries,
 * so we construct one locally for UI display and location tracking.
 */
function operationToHistoryEntry(operation: PreparedMeltOp): MeltHistoryEntry {
  return {
    id: operation.id,
    type: 'melt',
    createdAt: Date.now(),
    mintUrl: operation.mintUrl,
    unit: 'sat',
    quoteId: operation.quoteId,
    state: 'UNPAID',
    amount: operation.amount,
  };
}

/**
 * Two-step melt flow hook: `prepareMeltQuote` → `executeMeltQuote`.
 *
 * Constructs quote and history entry data from the operation returned by
 * `manager.quotes.prepareMeltBolt11`, then `executeMelt` completes payment.
 * Also exposes a one-shot `melt()` for flows that don't need intermediate UI.
 */
export function useMeltWithHistory() {
  const manager = useManager();
  const [status, setStatus] = useState<MeltStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<MeltQuoteResult | null>(null);
  const isProcessingRef = useRef(false);

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

      try {
        const operation = await manager.quotes.prepareMeltBolt11(mintUrl, invoice);

        const quote = operationToQuote(operation, invoice);
        const historyEntry = operationToHistoryEntry(operation);
        const result: MeltQuoteResult = {
          quote,
          historyEntry,
          operationId: operation.id,
        };

        setData(result);
        setStatus('idle');
        opts.onSuccess?.(result);
        return result;
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
    [manager]
  );

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
        await manager.quotes.executeMelt(operationId);

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

  const melt = useCallback(
    async (mintUrl: string, invoice: string, opts: MeltOptions = {}): Promise<MeltQuoteResult> => {
      const result = await prepareMeltQuote(mintUrl, invoice, opts);
      await executeMeltQuote(result.operationId, result.quote.quote, opts);
      return result;
    },
    [prepareMeltQuote, executeMeltQuote]
  );

  /**
   * Cancel (rollback) a prepared or pending melt operation and free its reserved proofs.
   *
   * For prepared (UNPAID) operations this immediately releases proofs.
   * For pending operations it checks with the mint first — if the quote is
   * still UNPAID the proofs are released; if PAID or in-flight, cancel is rejected.
   */
  const cancelMeltQuote = useCallback(
    async (opts: { operationId?: string; mintUrl?: string; quoteId?: string }): Promise<void> => {
      let resolvedId = opts.operationId;
      if (!resolvedId && opts.mintUrl && opts.quoteId) {
        const [prepared, pending] = await Promise.all([
          manager.quotes.getPreparedMeltOperations(),
          manager.quotes.getPendingMeltOperations(),
        ]);
        const all = [...prepared, ...pending];
        const op = all.find(
          (o) => o.mintUrl === opts.mintUrl && 'quoteId' in o && o.quoteId === opts.quoteId
        );
        if (!op) {
          throw new Error('No melt operation found for this quote');
        }
        resolvedId = op.id;
      }

      if (!resolvedId) {
        throw new Error('No operation ID or quote ID provided');
      }

      await manager.quotes.rollbackMelt(resolvedId, 'User cancelled');

      if (data && data.operationId === resolvedId) {
        setData(null);
      }
      setStatus('idle');
      setError(null);
    },
    [manager, data]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setData(null);
  }, []);

  return {
    prepareMeltQuote,
    executeMeltQuote,
    cancelMeltQuote,
    melt,

    data,
    quote: data?.quote ?? null,
    historyEntry: data?.historyEntry ?? null,
    operationId: data?.operationId ?? null,

    status,
    error,
    isCreating: status === 'creating',
    isPaying: status === 'paying',
    isLoading: status === 'creating' || status === 'paying',
    isError: status === 'error',
    isSuccess: status === 'success',

    reset,
  };
}
