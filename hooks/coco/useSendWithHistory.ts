import { useCallback, useRef, useState } from 'react';
import { OutputData, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { OutputConfig, Token } from '@cashu/cashu-ts';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

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

interface SendP2PKOptions {
  onSuccess?: (token: Token) => void;
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

  const sendP2PKToken = useCallback(
    async (
      mintUrl: string,
      amount: number,
      recipientPubkey: string,
      opts: SendP2PKOptions = {}
    ): Promise<Token> => {
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

      if (!recipientPubkey || recipientPubkey.trim().length === 0) {
        const err = new Error('Recipient pubkey is required for P2PK send');
        opts.onError?.(err);
        throw err;
      }

      isSendingRef.current = true;
      setStatus('loading');
      setError(null);
      setData(null);

      const splitAmountForKeyset = (value: number, keys: Record<number, string>): number[] => {
        const split: number[] = [];
        const sortedKeyAmounts = Object.keys(keys)
          .map((k) => Number(k))
          .sort((a, b) => b - a);
        if (!sortedKeyAmounts.length) {
          throw new Error('Cannot split amount, keyset is inactive or contains no keys');
        }
        let remaining = value;
        for (const amt of sortedKeyAmounts) {
          if (amt <= 0) continue;
          const requireCount = Math.floor(remaining / amt);
          if (requireCount > 0) {
            split.push(...Array<number>(requireCount).fill(amt));
            remaining -= amt * requireCount;
          }
          if (remaining === 0) break;
        }
        if (remaining !== 0) {
          throw new Error(`Unable to split remaining amount: ${remaining}`);
        }
        return split;
      };

      const operationId = `p2pk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let reservedInputSecrets: string[] | null = null;

      try {
        const { wallet, keys } = await manager.walletService.getWalletWithActiveKeysetId(mintUrl);

        const selectedProofs = await manager.proofService.selectProofsToSend(mintUrl, amount, true);
        const selectedAmount = selectedProofs.reduce(
          (acc: number, p: { amount: number }) => acc + p.amount,
          0
        );
        const fees = wallet.getFeesForProofs(selectedProofs);
        const keepAmount = selectedAmount - amount - fees;
        if (keepAmount < 0) {
          throw new Error('Insufficient balance to cover amount + fees');
        }

        const inputSecrets = selectedProofs.map((p: { secret: string }) => p.secret);
        reservedInputSecrets = inputSecrets;
        await manager.proofService.reserveProofs(mintUrl, inputSecrets, operationId);

        const keepOutputsRes = await manager.proofService.createOutputsAndIncrementCounters(
          mintUrl,
          { keep: keepAmount, send: 0 },
          undefined
        );
        const keepOutputs = keepOutputsRes?.keep ?? [];

        const denoms = splitAmountForKeyset(amount, keys.keys);
        const sendOutputs = denoms.map((d) =>
          OutputData.createSingleP2PKData({ pubkey: recipientPubkey }, d, keys.id)
        );

        const outputConfig: OutputConfig = {
          send: { type: 'custom', data: sendOutputs },
          keep: { type: 'custom', data: keepOutputs },
        };

        const { send: sendProofs, keep: keepProofs } = await wallet.send(
          amount,
          selectedProofs,
          undefined,
          outputConfig
        );

        const coreKeep = keepProofs.map((p: any) => ({ ...p, mintUrl, state: 'ready' }));
        const coreSend = sendProofs.map((p: any) => ({ ...p, mintUrl, state: 'inflight' }));
        await manager.proofService.saveProofs(mintUrl, [...coreKeep, ...coreSend]);
        await manager.proofService.setProofState(mintUrl, inputSecrets, 'spent');
        await manager.proofService.releaseProofs(mintUrl, inputSecrets);
        reservedInputSecrets = null;

        const token: Token = { mint: mintUrl, proofs: sendProofs, unit: wallet.unit };
        setStatus('success');
        opts.onSuccess?.(token);
        return token;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus('error');
        opts.onError?.(err);
        if (reservedInputSecrets) {
          try {
            await manager.proofService.releaseProofs(mintUrl, reservedInputSecrets);
          } catch {
            // ignore cleanup errors
          }
        }
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
    sendP2PKToken,
    reset,
    status,
    data,
    error,
    isSending: status === 'loading',
    isError: status === 'error',
  };
}
