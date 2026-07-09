import { useEffect, useState } from 'react';

import {
  DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
  defaultChainAdapter,
  shouldStopTxConfirmationPolling,
  type ChainTransactionStatus,
} from 'wallet';
import { log } from '@/shared/lib/logger';

// Polls a bit faster than the address watcher (70s) since confirmations advance
// block-by-block and this only runs while an onchain-send detail is open.
const MEMPOOL_TX_POLL_MS = 30_000;

/**
 * Live confirmation status for a KNOWN transaction (onchain SEND), keyed off the
 * txid we already have from coco's melt-quote `outpoint`. Mainnet mempool.space
 * via the chain adapter's `getTransactionStatus` (`GET /tx/{txid}/status`).
 * `confirmations` is 0 while the tx is in the mempool, ≥1 once mined. Returns
 * `status: null` until the first fetch resolves (or when no txid is known yet).
 *
 * Polling stops once the tx reaches `requiredConfirmations` (the UI caps its
 * display there, so nothing rendered can change), and never starts at all on a
 * non-mainnet adapter — the mempool.space API is mainnet-only, so polling
 * would just 404 every 30s (`unsupportedNetwork` tells the caller to hide
 * explorer affordances too).
 */
export function useMempoolTxConfirmations(
  txid: string | null | undefined,
  {
    requiredConfirmations = DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
  }: { requiredConfirmations?: number } = {}
): {
  status: ChainTransactionStatus | null;
  isLoading: boolean;
  error: Error | null;
  unsupportedNetwork: boolean;
} {
  const normalized = txid?.trim().toLowerCase() || null;
  const unsupportedNetwork = defaultChainAdapter.network !== 'mainnet';
  const [status, setStatus] = useState<ChainTransactionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!normalized || unsupportedNetwork) {
      setIsLoading(false);
      setError(null);
      if (normalized && unsupportedNetwork) {
        log.info('mempool.tx.confirmations.unsupported_network', {
          network: defaultChainAdapter.network,
        });
      }
      return;
    }

    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const poll = async () => {
      setIsLoading(true);
      try {
        const result = await defaultChainAdapter.getTransactionStatus(normalized);
        if (!mounted) return;
        setStatus(result);
        setError(null);
        log.debug('mempool.tx.confirmations.result', {
          txidLength: normalized.length,
          confirmed: result?.confirmed ?? null,
          confirmations: result?.confirmations ?? null,
        });
        // Mined + at required depth: the rendered ring is capped there, so
        // nothing another poll returns can change the UI.
        if (shouldStopTxConfirmationPolling(result, requiredConfirmations)) {
          stopPolling();
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err : new Error(String(err)));
        log.warn('mempool.tx.confirmations.failed', {
          txidLength: normalized.length,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void poll();
    interval = setInterval(() => void poll(), MEMPOOL_TX_POLL_MS);
    return () => {
      mounted = false;
      stopPolling();
    };
  }, [normalized, requiredConfirmations, unsupportedNetwork]);

  return { status, isLoading, error, unsupportedNetwork };
}
