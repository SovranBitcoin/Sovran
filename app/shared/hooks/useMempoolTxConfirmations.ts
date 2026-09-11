import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

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

interface ConfirmationState {
  txid: string | null;
  status: ChainTransactionStatus | null;
  isLoading: boolean;
  error: Error | null;
}

interface PollingRuntime {
  state: ConfirmationState;
  pending: Map<string, Promise<ChainTransactionStatus | null>>;
}

const emptyState: ConfirmationState = {
  txid: null,
  status: null,
  isLoading: false,
  error: null,
};

function startPolling(
  txid: string,
  requiredConfirmations: number,
  runtime: PollingRuntime,
  setState: (state: ConfirmationState) => void
): () => void {
  let state = runtime.state.txid === txid ? runtime.state : { ...emptyState, txid };
  let active = AppState.currentState === 'active';
  let disposed = false;
  let running = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: ConfirmationState) => {
    state = next;
    runtime.state = next;
    setState(next);
  };
  const complete = () => shouldStopTxConfirmationPolling(state.status, requiredConfirmations);
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  async function poll() {
    if (disposed || !active || running || complete()) return;
    running = true;
    const startedGeneration = generation;
    const current = () => !disposed && active && generation === startedGeneration;
    publish({ ...state, isLoading: true });
    try {
      // The adapter cannot abort. A refocus waits for its previous request to
      // settle before starting a fresh read; different txids remain independent.
      const previous = runtime.pending.get(txid);
      if (previous) await previous.catch(() => undefined);
      if (!current()) return;
      const request = defaultChainAdapter.getTransactionStatus(txid);
      runtime.pending.set(txid, request);
      let result: ChainTransactionStatus | null;
      try {
        result = await request;
      } finally {
        if (runtime.pending.get(txid) === request) runtime.pending.delete(txid);
      }
      if (!current()) return;
      publish({ txid, status: result, error: null, isLoading: false });
      log.debug('mempool.tx.confirmations.result', {
        txidLength: txid.length,
        confirmed: result?.confirmed ?? null,
        confirmations: result?.confirmations ?? null,
      });
    } catch (err) {
      if (!current()) return;
      publish({
        ...state,
        error: err instanceof Error ? err : new Error(String(err)),
        isLoading: false,
      });
      log.warn('mempool.tx.confirmations.failed', {
        txidLength: txid.length,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
      if (!disposed && active && !complete()) {
        if (generation !== startedGeneration) void poll();
        else timer = setTimeout(() => void poll(), MEMPOOL_TX_POLL_MS);
      }
    }
  }

  publish({ ...state, isLoading: false });
  const subscription = AppState.addEventListener('change', (next) => {
    const nextActive = next === 'active';
    if (nextActive === active) return;
    active = nextActive;
    generation += 1;
    clearTimer();
    if (active) void poll();
    else publish({ ...state, isLoading: false });
  });
  void poll();
  return () => {
    disposed = true;
    generation += 1;
    clearTimer();
    subscription.remove();
  };
}

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
  const [state, setState] = useState<ConfirmationState>(emptyState);
  const runtime = useRef<PollingRuntime>({ state: emptyState, pending: new Map() });

  useFocusEffect(
    useCallback(() => {
      if (!normalized || unsupportedNetwork) return;
      return startPolling(normalized, requiredConfirmations, runtime.current, setState);
    }, [normalized, requiredConfirmations, unsupportedNetwork])
  );

  // A new txid must never paint another transaction's status, even before its
  // focus effect runs. Cached status remains visible during same-tx refreshes.
  const visible = state.txid === normalized && !unsupportedNetwork ? state : emptyState;
  return {
    status: visible.status,
    isLoading: visible.isLoading,
    error: visible.error,
    unsupportedNetwork,
  };
}
