import { useCallback, useRef, useState } from 'react';
import type { Token } from '@cashu/cashu-ts';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';

type SendStatus = 'idle' | 'loading' | 'success' | 'error';

interface SendResult {
  token: Token;
  historyEntry: SendHistoryEntry;
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

      const entryPromise = new Promise<SendHistoryEntry>((resolve) => {
        resolveEntryPromise = resolve;
      });

      // Set up one-time listener for history:updated event
      // This will fire right after send:created when HistoryService creates the entry
      const unsubscribe = manager.once('history:updated', ({ entry }) => {
        if (entry.type === 'send') {
          capturedEntry = entry as SendHistoryEntry;
          resolveEntryPromise(capturedEntry);
        }
      });

      try {
        // Perform the send operation
        const token = await manager.wallet.send(mintUrl, amount);

        // Wait for the history entry to be captured (should be nearly instant)
        // Add a timeout just in case
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for history entry')), 5000);
        });

        const historyEntry = await Promise.race([entryPromise, timeoutPromise]);

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

          const result = { token, historyEntry: matchingEntry };
          setData(result);
          setStatus('success');
          opts.onSuccess?.(result);
          return result;
        }

        const result = { token, historyEntry };
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
