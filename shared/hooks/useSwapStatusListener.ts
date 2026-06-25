import { useEffect } from 'react';

import { isSwapStatusToastMounted, swapStatusPopup } from '@/shared/lib/popup';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import type { ProgressState } from '@/shared/stores/runtime/legProgress';
import { paymentLog } from '@/shared/lib/logger';

const TERMINAL_STATES: ReadonlySet<ProgressState> = new Set<ProgressState>([
  'done',
  'failed',
  'cancelled',
]);

/**
 * Re-pops the unified Swap toast when the swap reaches a terminal state with
 * no toast mounted — e.g. the user swiped the in-flight 'Swapping' toast and
 * the orchestrator later resolves the runner via `complete()` / `fail()` /
 * `cancel()`. Without this, `swapStatusPopup`'s mid-flight onHide guard would
 * silently leave the user with no terminal-state surface.
 *
 * Pairs with the onHide gate in `swapStatusPopup`: that guard keeps the
 * store populated through a mid-flight dismissal so AccountPagerViewLayout's
 * payment-button gate stays disabled; this listener restores the missing
 * terminal toast.
 */
export function useSwapStatusListener(): void {
  useEffect(() => {
    let prevState: ProgressState | undefined = useSwapStatusStore.getState().active?.state;
    return useSwapStatusStore.subscribe((s) => {
      const nextState = s.active?.state;
      const transitionedToTerminal =
        prevState === 'running' && nextState !== undefined && TERMINAL_STATES.has(nextState);
      prevState = nextState;
      if (!transitionedToTerminal) return;
      if (isSwapStatusToastMounted()) return;
      paymentLog.info('hook.swap_status.repop_terminal', { state: nextState });
      swapStatusPopup();
    });
  }, []);
}
