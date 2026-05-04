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
 * auto-dismisses 3s later. Also clears `useSwapStatusStore.active` on hide.
 */
export function swapStatusPopup(): void {
  showCustomToast({
    component: (toastProps) => React.createElement(SwapStatusToast, toastProps),
    duration: 'persistent',
    onHide: () => {
      // Defensive — the toast clears too, but a manual dismiss path
      // (e.g. user swipes) needs the store reset to avoid stale state on
      // the next swap.
      useSwapStatusStore.getState().clear();
    },
  });
}

export const sendSuccessPopup = makeStaticPopup({
  message: 'Funds Sent',
  text: 'Funds have been sent successfully.',
  icon: 'icon:mdi:send',
  type: 'success',
});

export const receiveSuccessPopup = makeParamPopup<{ amount: number; unit: string }>(
  ({ amount, unit }) => ({
    message: 'Funds Received',
    text: `${amount} ${unit} has been added to your wallet.`,
    icon: 'icon:mdi:check-circle',
    type: 'success',
  })
);

export const nostrPaymentSentPopup = makeStaticPopup({
  message: 'Payment sent successfully via Nostr',
  icon: 'icon:mdi:send',
  type: 'success',
});

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
