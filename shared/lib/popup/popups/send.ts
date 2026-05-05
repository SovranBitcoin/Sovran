import { makeStaticPopup, makeParamPopup } from './factory';

const ALERT_ICON = 'icon:mdi:alert-circle-outline';

export const sendPaymentFailedPopup = makeStaticPopup({
  message: 'Failed to send payment',
  icon: 'icon:mdi:send',
  type: 'error',
});

export const cancelTransactionFailedPopup = makeStaticPopup({
  message: 'Failed to cancel transaction',
  icon: 'icon:mdi:close-circle',
  type: 'error',
});

export const operationNotFoundPopup = makeStaticPopup({
  message: 'Operation not found',
  icon: 'icon:majesticons:search-line',
  type: 'error',
});

export const mintUnreachablePopup = makeStaticPopup({
  message: 'Could not connect to mint',
  text: 'Check your connection or try again later.',
  icon: 'icon:feather:wifi',
  type: 'error',
});

export const couldNotCancelPopup = makeStaticPopup({
  message: 'Could not cancel',
  icon: 'icon:mdi:close-circle',
  type: 'error',
});

export const operationInvalidStatePopup = makeParamPopup<{ state: string }>(({ state }) => ({
  message: 'Cannot check operation status',
  text: `Operation is in "${state}" state.`,
  icon: ALERT_ICON,
  type: 'error',
}));

/** For coco-payment-ux NO_AMOUNT. */
export const noAmountPopup = makeStaticPopup({
  message: 'Amount Required',
  text: 'Please enter an amount.',
  icon: 'icon:mdi:currency-usd',
  type: 'error',
});

/** For coco-payment-ux UNSUPPORTED_INPUT. */
export const unsupportedInputPopup = makeStaticPopup({
  message: 'Unsupported Input',
  text: 'This input format is not supported.',
  icon: ALERT_ICON,
  type: 'error',
});

/** For coco-payment-ux ALL_OPTIONS_DISABLED. */
export const allOptionsDisabledPopup = makeStaticPopup({
  message: 'No Options Available',
  text: 'All payment options are disabled.',
  icon: ALERT_ICON,
  type: 'warning',
});

/** For coco-payment-ux MISSING_MELT_TARGET. */
export const missingMeltTargetPopup = makeStaticPopup({
  message: 'Missing Payment Target',
  text: 'A Lightning invoice or address is required for this flow.',
  icon: 'icon:mingcute:lightning-fill',
  type: 'error',
});
