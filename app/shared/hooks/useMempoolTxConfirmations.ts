import { useEffect, useState } from 'react';

import { defaultChainAdapter, type ChainTransactionStatus } from 'wallet';
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
 */
export function useMempoolTxConfirmations(txid: string | null | undefined): {
  status: ChainTransactionStatus | null;
  isLoading: boolean;
  error: Error | null;
} {
  const normalized = txid?.trim().toLowerCase() || null;
  const [status, setStatus] = useState<ChainTransactionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!normalized) {
      setIsLoading(false);
      setError(null);
      return;
    }

    let mounted = true;
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
    const interval = setInterval(() => void poll(), MEMPOOL_TX_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [normalized]);

  return { status, isLoading, error };
}
