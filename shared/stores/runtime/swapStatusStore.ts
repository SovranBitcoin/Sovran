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
 * Not persisted — swaps are per-session and tied to the in-memory
 * MintRebalancePlanScreen state.
 */

import { create } from 'zustand';

import { paymentLog } from '@/shared/lib/logger';

type SwapLegStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export type SwapState = 'running' | 'done' | 'failed' | 'cancelled';

export interface SwapLeg {
  id: string;
  /** Optional human label, e.g. "Mint A → Mint B" — used in the toast subtitle. */
  label?: string;
  status: SwapLegStatus;
  errorMessage?: string;
}

interface ActiveSwap {
  /** Stable id used to correlate updates with the toast. */
  id: string;
  startedAt: number;
  state: SwapState;
  unit: string;
  legs: SwapLeg[];
  /** Total amount being swapped, in `unit`. Optional — shown in the header when present. */
  totalAmount?: number;
  /** Last failure text, set when state flips to 'failed'. */
  errorMessage?: string;
  /** SwapTransactions group id — backs the toast's "View" button so the user
   *  can jump straight to the transaction detail when the swap completes. */
  groupId?: string;
}

interface SwapStatusStore {
  active: ActiveSwap | null;
  start: (params: {
    id: string;
    unit: string;
    totalAmount?: number;
    groupId?: string;
    legs: { id: string; label?: string }[];
  }) => void;
  setActiveLeg: (legId: string) => void;
  setLegDone: (legId: string) => void;
  setLegSkipped: (legId: string) => void;
  setLegFailed: (legId: string, errorMessage?: string) => void;
  complete: () => void;
  fail: (errorMessage?: string) => void;
  cancel: (errorMessage?: string) => void;
  /** Clear without firing terminal logs — used when the toast auto-dismisses. */
  clear: () => void;
}

export const useSwapStatusStore = create<SwapStatusStore>((set, get) => ({
  active: null,
  start: ({ id, unit, totalAmount, groupId, legs }) => {
    paymentLog.info('swap.status.start', { id, groupId, legCount: legs.length, totalAmount, unit });
    set({
      active: {
        id,
        startedAt: Date.now(),
        state: 'running',
        unit,
        totalAmount,
        groupId,
        legs: legs.map((l) => ({ ...l, status: 'pending' as const })),
      },
    });
  },
  setActiveLeg: (legId) =>
    set((s) => {
      if (!s.active) return s;
      const legs = s.active.legs.map((l) =>
        l.id === legId ? { ...l, status: 'active' as const } : l
      );
      return { active: { ...s.active, legs } };
    }),
  setLegDone: (legId) =>
    set((s) => {
      if (!s.active) return s;
      const legs = s.active.legs.map((l) =>
        l.id === legId ? { ...l, status: 'done' as const } : l
      );
      return { active: { ...s.active, legs } };
    }),
  setLegSkipped: (legId) =>
    set((s) => {
      if (!s.active) return s;
      const legs = s.active.legs.map((l) =>
        l.id === legId ? { ...l, status: 'skipped' as const } : l
      );
      return { active: { ...s.active, legs } };
    }),
  setLegFailed: (legId, errorMessage) =>
    set((s) => {
      if (!s.active) return s;
      const legs = s.active.legs.map((l) =>
        l.id === legId ? { ...l, status: 'failed' as const, errorMessage } : l
      );
      return { active: { ...s.active, legs } };
    }),
  complete: () => {
    const cur = get().active;
    if (!cur) return;
    paymentLog.info('swap.status.complete', {
      id: cur.id,
      durationMs: Date.now() - cur.startedAt,
      doneLegs: cur.legs.filter((l) => l.status === 'done').length,
      totalLegs: cur.legs.length,
    });
    set({ active: { ...cur, state: 'done' } });
  },
  fail: (errorMessage) => {
    const cur = get().active;
    if (!cur) return;
    paymentLog.warn('swap.status.fail', {
      id: cur.id,
      durationMs: Date.now() - cur.startedAt,
      errorMessage,
    });
    set({ active: { ...cur, state: 'failed', errorMessage } });
  },
  cancel: (errorMessage) => {
    const cur = get().active;
    if (!cur) return;
    paymentLog.info('swap.status.cancel', {
      id: cur.id,
      durationMs: Date.now() - cur.startedAt,
      doneLegs: cur.legs.filter((l) => l.status === 'done').length,
      totalLegs: cur.legs.length,
    });
    set({ active: { ...cur, state: 'cancelled', errorMessage } });
  },
  clear: () => {
    if (get().active) paymentLog.debug('swap.status.clear');
    set({ active: null });
  },
}));

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
