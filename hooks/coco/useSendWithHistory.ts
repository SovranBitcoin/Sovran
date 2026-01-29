import { useCallback, useRef, useState } from 'react';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { Token } from '@cashu/cashu-ts';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

type SendStatus = 'idle' | 'loading' | 'success' | 'error';

interface SendResult {
  token: Token;
  historyEntry: SendHistoryEntry;
  /** The send operation ID (for finalize/rollback if needed) */
  operationId: string;
}

interface SendOptions {
  onSuccess?: (result: SendResult) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

/**
 * Enhanced send hook that captures the history entry using coco events.
 * This is the coco-idiomatic way to send and get the full history entry.
 *
 * Uses the new v3 two-step send flow:
 * 1. prepareSend() - prepares the operation and reserves proofs
 * 2. executePreparedSend() - executes the prepared operation
 *
 * Instead of searching through paginated history after a send,
 * this hook listens to the `history:updated` event to capture
 * the SendHistoryEntry directly when it's created.
 */
export function useSendWithHistory() {
  const manager = useManager();
  const [status, setStatus] = useState<SendStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<SendResult | null>(null);
  const isSendingRef = useRef(false);

  const send = useCallback(
    async (mintUrl: string, amount: number, opts: SendOptions = {}): Promise<SendResult> => {
      if (isSendingRef.current) {
        const err = new Error('Send already in progress');
        opts.onError?.(err);
        throw err;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        const err = new Error('Amount must be a positive number');
        opts.onError?.(err);
        throw err;
      }

      isSendingRef.current = true;
      setStatus('loading');
      setError(null);

      // Create a promise that resolves when we capture the history entry
      let capturedEntry: SendHistoryEntry | null = null;
      let resolveEntryPromise: (entry: SendHistoryEntry) => void;
      let targetOperationId: string | null = null;

      const entryPromise = new Promise<SendHistoryEntry>((resolve) => {
        resolveEntryPromise = resolve;
      });

      // Set up listener for history:updated event
      // In v3, the history entry is created on send:pending (after execute)
      const unsubscribe = manager.on('history:updated', ({ entry }) => {
        if (entry.type === 'send') {
          const sendEntry = entry as SendHistoryEntry;
          // Match by operationId if we have it, otherwise accept first send entry
          if (!targetOperationId || sendEntry.operationId === targetOperationId) {
            capturedEntry = sendEntry;
            resolveEntryPromise(capturedEntry);
          }
        }
      });

      try {
        // Step 1: Prepare the send operation using new v3 API
        const prepared = await manager.send.prepareSend(mintUrl, amount);
        targetOperationId = prepared.id;

        // Step 2: Execute the prepared send operation
        const { token, operation } = await manager.send.executePreparedSend(prepared.id);

        // Wait for the history entry to be captured (should be nearly instant)
        // Add a timeout just in case
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for history entry')), 5000);
        });

        const historyEntry = await Promise.race([entryPromise, timeoutPromise]);
        unsubscribe();

        // In the newer coco version, token might be optional on SendHistoryEntry
        // Verify this is the right entry by comparing tokens (if available)
        const entryToken = historyEntry.token;
        if (entryToken && getEncodedTokenV4(entryToken) !== getEncodedTokenV4(token)) {
          // If tokens don't match, fall back to searching history
          const history = await manager.history.getPaginatedHistory(0, 10);
          const matchingEntry = history.find((h) => {
            if (h.type !== 'send') return false;
            const sendEntry = h as SendHistoryEntry;
            return (
              sendEntry.token && getEncodedTokenV4(sendEntry.token) === getEncodedTokenV4(token)
            );
          }) as SendHistoryEntry | undefined;

          if (!matchingEntry) {
            throw new Error('Failed to find send history entry');
          }

          const result = { token, historyEntry: matchingEntry, operationId: operation.id };
          setData(result);
          setStatus('success');
          opts.onSuccess?.(result);
          return result;
        }

        const result = { token, historyEntry, operationId: operation.id };
        setData(result);
        setStatus('success');
        opts.onSuccess?.(result);
        return result;
      } catch (e) {
        unsubscribe(); // Clean up listener on error
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus('error');
        opts.onError?.(err);
        throw err;
      } finally {
        isSendingRef.current = false;
        opts.onSettled?.();
      }
    },
    [manager]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setData(null);
  }, []);

  return {
    send,
    reset,
    status,
    data,
    error,
    isSending: status === 'loading',
    isError: status === 'error',
  };
}
