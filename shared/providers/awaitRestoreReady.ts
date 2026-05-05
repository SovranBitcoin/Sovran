export type RestoreReadyStatus =
  | 'unknown'
  | 'not-needed'
  | 'pending'
  | 'in-progress'
  | 'complete'
  | 'failed';

const isReady = (s: RestoreReadyStatus) => s === 'complete' || s === 'not-needed';

export interface RestoreReadyStore {
  getState: () => { restoreStatus: RestoreReadyStatus };
  subscribe: (
    listener: (
      state: { restoreStatus: RestoreReadyStatus },
      prev: { restoreStatus: RestoreReadyStatus }
    ) => void
  ) => () => void;
}

/**
 * Resolves once the wallet-lifecycle restoreStatus is 'complete' or 'not-needed'
 * — the safe-to-mint signal. Used to gate NPC sync + the mint-operation
 * processor so they don't fire on a counter the mint already signed.
 *
 * The subscriber is registered BEFORE the current-state read so that a
 * status flip happening between the two operations (or persist hydration's
 * setState landing before getState is called) cannot leave the promise hung.
 */
export function awaitRestoreReady(store: RestoreReadyStore): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve();
    };
    const unsub = store.subscribe((state) => {
      if (isReady(state.restoreStatus)) finish();
    });
    unsubscribe = unsub;
    // If the listener fired synchronously during subscribe, the early
    // unsubscribe?.() above was a no-op — clean up now.
    if (settled) unsub();
    if (isReady(store.getState().restoreStatus)) finish();
  });
}
