import { isSafeToMint, type RestoreStatus } from '@/shared/stores/global/walletRestorePhase';

interface RestoreReadyStore {
  getState: () => { restoreStatus: RestoreStatus };
  subscribe: (
    listener: (
      state: { restoreStatus: RestoreStatus },
      prev: { restoreStatus: RestoreStatus }
    ) => void
  ) => () => void;
}

/**
 * Resolves once the wallet-lifecycle restoreStatus is 'complete' or 'not-needed'
 * — the safe-to-mint signal — or immediately when `signal` aborts (so an
 * account switch mid-restore unsubscribes instead of leaking the listener).
 */
export function awaitRestoreReady(
  store: RestoreReadyStore,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', finish);
      unsubscribe?.();
      resolve();
    };
    signal?.addEventListener('abort', finish, { once: true });
    const unsub = store.subscribe((state) => {
      if (isSafeToMint(state.restoreStatus)) finish();
    });
    unsubscribe = unsub;
    if (settled) unsub();
    if (isSafeToMint(store.getState().restoreStatus)) finish();
  });
}
