/**
 * Runtime store for the unified Swap status toast.
 *
 * A swap is a sequence of N legs (mint → melt pairs, possibly chained through
 * middlemen). Without this store each leg's mint-op:* / melt-op:* event would
 * fire its own `paymentStatusPopup` toast, drowning the user in a stack of
 * receive-and-send notifications. The orchestrator declares the legs upfront,
 * the toast component subscribes to this store, and the listener in
 * `usePaymentStatusListener` skips its per-op toasts while a swap is active.
 *
 * The leg state machine lives in `createLegProgressStore`; this module only
 * pins the swap-specific meta (unit/totalAmount/groupId) and the
 * `isSwapStatusActive` gate.
 *
 * Not persisted — swaps are per-session and tied to the in-memory
 * MintRebalancePlanScreen state.
 */

import { paymentLog } from '@/shared/lib/logger';

import { createLegProgressStore } from './legProgress';

interface SwapMeta {
  unit: string;
  /** Total amount being swapped, in `unit`. Shown in the header when present. */
  totalAmount?: number;
  /** SwapTransactions group id — backs the toast's "View" button. */
  groupId?: string;
}

export const useSwapStatusStore = createLegProgressStore<SwapMeta>({
  name: 'swap',
  log: paymentLog,
});

/**
 * Read-only check used by `usePaymentStatusListener` to decide whether a
 * per-op popup should fire. Anything in the `running` phase suppresses the
 * standard receive/send popups so the unified Swap toast is the single
 * surface shown to the user.
 */
export function isSwapStatusActive(): boolean {
  const s = useSwapStatusStore.getState().active;
  return !!s && s.state === 'running';
}
