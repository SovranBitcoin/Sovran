import React from 'react';
import { onToastStackConnected, showCustomToast } from './bridge';
import { PaymentStatusToast } from '../PaymentStatusToast';
import { popupLog } from '@/shared/lib/logger';
import {
  paymentToasts,
  usePaymentStatusStore,
  type PaymentToastView,
} from '@/shared/stores/runtime/paymentStatusStore';
import { makeStaticPopup, makeParamPopup } from './factory';

/** Payment toasts on the stack, by toast id, with the function that takes each off. */
const mounted = new Map<string, () => void>();

/**
 * Keep the toast stack in step with the payment toast machine: put up each
 * toast it says is on screen, take down each it no longer lists. The toast
 * itself re-draws from the store, so a change of phase never remounts it.
 *
 * A toast the person swipes away (or the stack evicts) is reported back, so
 * the machine knows it is no longer on screen.
 */
function syncPaymentToasts(toasts: readonly PaymentToastView[]): void {
  const listed = new Set(toasts.map((toast) => toast.id));
  for (const [id, takeDown] of [...mounted]) {
    if (listed.has(id)) continue;
    mounted.delete(id);
    takeDown();
  }
  for (const toast of toasts) {
    if (mounted.has(toast.id)) continue;
    const { id } = toast;
    popupLog.info('popup.payment_status.show', { paymentToastId: id, phase: toast.phase });
    const takeDown = showCustomToast({
      component: (toastProps) =>
        React.createElement(PaymentStatusToast, { ...toastProps, paymentToastId: id }),
      // The machine owns every timer: the stack only holds the toast.
      durationMs: 'persistent',
      debugLabel: 'payment-status',
      debugFields: { paymentToastId: id },
      onHide: () => {
        // Taken down by the sync above: nothing to report.
        if (!mounted.delete(id)) return;
        popupLog.info('popup.payment_status.dismissed', { paymentToastId: id });
        paymentToasts.userDismissed(id);
      },
    });
    // With no stack mounted the toast was dropped; the next change retries.
    if (takeDown) mounted.set(id, takeDown);
  }
}

// Installed once, when the popup module loads (the app's root imports it).
usePaymentStatusStore.subscribe((state) => syncPaymentToasts(state.toasts));
onToastStackConnected(() => syncPaymentToasts(usePaymentStatusStore.getState().toasts));

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
