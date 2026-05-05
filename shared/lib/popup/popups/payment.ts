import React from 'react';
import { showCustomToast } from './bridge';
import { PaymentStatusToast } from '../PaymentStatusToast';
import { SwapStatusToast } from '../SwapStatusToast';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { makeStaticPopup, makeParamPopup } from './factory';

type PaymentStatusVariant = 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request';

export function paymentStatusPopup(payload: {
  variant: PaymentStatusVariant;
  id: string;
  mintUrl: string;
  amount: number;
  unit: string;
  operationId?: string;
  receiveEntryId?: string;
}): void {
  const { variant, id, amount, unit, mintUrl, operationId, receiveEntryId } = payload;
  showCustomToast({
    component: (toastProps) =>
      React.createElement(PaymentStatusToast, {
        ...toastProps,
        variant,
        paymentId: id,
        mintUrl,
        amount,
        unit,
        ...(operationId !== undefined && { operationId }),
        ...(receiveEntryId !== undefined && { receiveEntryId }),
      }),
    duration: 'persistent',
    onHide: () => usePaymentStatusStore.getState().setActive(null),
  });
}

/**
 * Show the unified swap-progress toast. The orchestrator calls
 * `useSwapStatusStore.start({ legs })` before this; the toast subscribes to
 * the store and re-renders as legs flip pending → active → done. On
 * `complete()` / `fail()` it animates to the green/red terminal state and
 * auto-dismisses 3s later.
 *
 * The store is only cleared on a terminal-state dismissal. A swipe while
 * `state === 'running'` leaves `active` in place so AccountPagerViewLayout's
 * payment-button gate stays load-bearing — clearing mid-flight would let the
 * user kick off a Send/Receive into coco's serialised mint/melt mutex.
 *
 * Idempotent: if a swap toast is already mounted, this is a no-op so
 * `useSwapStatusListener` can call it on running→terminal transitions
 * without racing the runner's own initial pop in MintRebalancePlanScreen.
 */
let swapToastMounted = false;

export function isSwapStatusToastMounted(): boolean {
  return swapToastMounted;
}

export function swapStatusPopup(): void {
  if (swapToastMounted) return;
  swapToastMounted = true;
  showCustomToast({
    component: (toastProps) => React.createElement(SwapStatusToast, toastProps),
    duration: 'persistent',
    onHide: () => {
      swapToastMounted = false;
      const cur = useSwapStatusStore.getState().active;
      // Mid-flight swipe leaves the gate engaged; clear only after the
      // toast unmounts in a terminal state (or the store is already empty).
      if (!cur || cur.state !== 'running') {
        useSwapStatusStore.getState().clear();
      }
    },
  });
}

export const paymentCancelledPopup = makeStaticPopup({
  message: 'Payment cancelled',
  text: 'Reserved proofs have been freed.',
  icon: 'icon:mdi:close-circle',
  type: 'success',
});

export const nfcEcashSharedPopup = makeStaticPopup({
  message: 'Ecash Token Shared via NFC',
  text: 'Ecash token has been shared via NFC.',
  icon: 'icon:lucide:nfc',
  type: 'success',
});

export const nfcConnectionLostPopup = makeStaticPopup({
  message: 'NFC connection lost. Send was rolled back.',
  icon: 'icon:feather:wifi',
  type: 'warning',
});

export const nfcSendFailedPopup = makeParamPopup<
  { text?: string; rollbackFailed?: boolean } | undefined
>((options) => ({
  message: options?.rollbackFailed ? 'NFC send failed and rollback failed' : 'NFC send failed',
  text: options?.text,
  icon: 'icon:lucide:nfc',
  type: 'error',
}));
