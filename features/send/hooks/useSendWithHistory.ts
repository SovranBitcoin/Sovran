import { useCallback, useRef, useState } from 'react';

import type { Token } from '@cashu/cashu-ts';
import { log } from '@/shared/lib/logger';
import { getEncodedToken, type SendHistoryEntry } from '@cashu/coco-core';
import { useManager } from '@cashu/coco-react';

type SendStatus = 'idle' | 'loading' | 'success' | 'error';

interface SendResult {
  token: Token;
  historyEntry: SendHistoryEntry;
  operationId: string;
}

interface SendOptions {
  onSuccess?: (result: SendResult) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

/**
 * Two-step send flow: `prepareSend` → `executePreparedSend`.
 *
 * Captures the resulting SendHistoryEntry via `history:updated` event
 * rather than searching paginated history after the fact.
 * Automatically rolls back the prepared operation on failure.
 *
 * COCO EXCEPTION: Token type is not re-exported from coco-cashu-core.
 * Flag for extraction.
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
      log.info('send.flow.start', { mintUrl, amount });

      let capturedEntry: SendHistoryEntry | null = null;
      let resolveEntryPromise: (entry: SendHistoryEntry) => void;
      let targetOperationId: string | null = null;
      let preparedOperationId: string | null = null;

      const entryPromise = new Promise<SendHistoryEntry>((resolve) => {
        resolveEntryPromise = resolve;
      });

      const unsubscribe = manager.on('history:updated', ({ entry }) => {
        if (entry.type === 'send') {
          const sendEntry = entry as SendHistoryEntry;
          if (!targetOperationId || sendEntry.operationId === targetOperationId) {
            capturedEntry = sendEntry;
            resolveEntryPromise(capturedEntry);
          }
        }
      });

      try {
        const prepared = await manager.ops.send.prepare({ mintUrl, amount });
        targetOperationId = prepared.id;
        preparedOperationId = prepared.id;

        const { token, operation } = await manager.ops.send.execute(prepared.id);

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for history entry')), 5000);
        });

        const historyEntry = await Promise.race([entryPromise, timeoutPromise]);
        unsubscribe();

        const entryToken = historyEntry.token;
        if (entryToken && getEncodedToken(entryToken) !== getEncodedToken(token)) {
          const history = await manager.history.getPaginatedHistory(0, 10);
          const matchingEntry = history.find((h) => {
            if (h.type !== 'send') return false;
            const sendEntry = h as SendHistoryEntry;
            return sendEntry.token && getEncodedToken(sendEntry.token) === getEncodedToken(token);
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
        log.info('send.flow.complete', { operationId: operation.id, amount });
        opts.onSuccess?.(result);
        return result;
      } catch (e) {
        unsubscribe();

        if (preparedOperationId) {
          try {
            const operation = await manager.ops.send.get(preparedOperationId);
            if (operation && operation.state === 'prepared') {
              await manager.ops.send.cancel(preparedOperationId);
            } else if (operation && ['executing', 'pending'].includes(operation.state)) {
              await manager.ops.send.reclaim(preparedOperationId);
            }
          } catch (rollbackError) {
            log.warn('send.rollback_failed', { error: rollbackError });
          }
        }

        const err = e instanceof Error ? e : new Error(String(e));
        log.error('send.flow.failed', { mintUrl, amount, error: err });
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
