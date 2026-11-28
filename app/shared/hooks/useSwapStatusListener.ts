import { useEffect } from 'react';

import {
  paymentToasts,
  toastKey,
  usePaymentStatusStore,
  type PaymentToastContent,
  type PaymentToastView,
} from '@/shared/stores/runtime/paymentStatusStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { paymentLog } from '@/shared/lib/logger';

type SwapRun = NonNullable<ReturnType<typeof useSwapStatusStore.getState>['active']>;

/**
 * What the swap's one toast says for the run as it stands: the step it is on
 * while running (never a count of steps — a long step followed by an instant
 * one would sit on "1 of 2" and then flash past the second), then how it ended.
 * An unsettled run is `slow`, never a failure: a payment is still in flight.
 */
export function swapToast(run: SwapRun): {
  phase: PaymentToastView['phase'];
  content: PaymentToastContent;
} {
  const groupId = run.meta.groupId;
  const steps = (title: string, subtitle: string | undefined): PaymentToastContent => ({
    kind: 'steps',
    title,
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
  });
  switch (run.state) {
    case 'running': {
      const current =
        run.legs.find((leg) => leg.status === 'active') ??
        run.legs.find((leg) => leg.status === 'pending');
      return { phase: 'working', content: steps('Swapping', current?.label) };
    }
    case 'done':
      return { phase: 'done', content: steps('Swap complete', undefined) };
    case 'failed':
      return { phase: 'failed', content: steps('Swap failed', run.errorMessage) };
    case 'cancelled':
      return { phase: 'failed', content: steps('Swap cancelled', run.errorMessage) };
    case 'unsettled':
      return { phase: 'slow', content: steps('Swap still settling', run.errorMessage) };
  }
}

/**
 * Drives the swap's toast from the swap status store: one toast for the whole
 * run, following its current step and then its result.
 *
 * A toast swiped away mid-run leaves the store as it is — the store is the
 * gate that keeps Send/Receive off the wallet while a swap runs — and the
 * run's result still gets a toast. The store is cleared only once the toast of
 * a run that has ended leaves the screen.
 */
export function useSwapStatusListener(): void {
  useEffect(() => {
    /** The run whose toast was last reported, and whether that toast has been on screen. */
    let reportedKey: string | null = null;
    let wasOnScreen = false;

    const report = (run: SwapRun | null): void => {
      const key = run ? toastKey.swap(run.id) : null;
      if (reportedKey !== null && reportedKey !== key) {
        // The store was cleared, or another run began: the old toast goes.
        paymentToasts.dismiss(reportedKey);
        wasOnScreen = false;
      }
      reportedKey = key;
      if (!run || key === null) return;
      const { phase, content } = swapToast(run);
      // A run reopened for a retry spins again; `start` is a no-op while it already does.
      if (phase === 'working') paymentToasts.start(key, content);
      paymentToasts.report(key, phase, content);
    };

    const offSwap = useSwapStatusStore.subscribe((state) => report(state.active));
    const offToasts = usePaymentStatusStore.subscribe((state) => {
      if (reportedKey === null) return;
      if (state.toasts.some((toast) => toast.key === reportedKey)) {
        wasOnScreen = true;
        return;
      }
      if (!wasOnScreen) return;
      wasOnScreen = false;
      // Its toast left the screen. A run still going keeps the store (and a
      // result toast to come); one that ended is finished with.
      const run = useSwapStatusStore.getState().active;
      if (!run || run.state === 'running') return;
      paymentLog.info('hook.swap_status.cleared_after_toast', { state: run.state });
      useSwapStatusStore.getState().clear();
    });
    report(useSwapStatusStore.getState().active);
    return () => {
      offSwap();
      offToasts();
    };
  }, []);
}
