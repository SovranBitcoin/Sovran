import { popup } from '../engine';
import type { BaseOverrides, TextOverrides } from './types';

export function invalidPaymentRequestPopup(): void {
  popup({ message: 'Invalid payment request', icon: 'icon:mdi:alert-circle-outline', type: 'error' });
}

export function sendPaymentFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to send payment',
    icon: 'icon:mdi:send',
    type: 'error',
    ...overrides,
  });
}

export function cancelTransactionFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to cancel transaction',
    icon: 'icon:mdi:close-circle',
    type: 'error',
    ...overrides,
  });
}

export function operationNotFoundPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Operation not found',
    icon: 'icon:majesticons:search-line',
    type: 'error',
    ...overrides,
  });
}

export function mintUnreachablePopup(overrides?: TextOverrides): void {
  popup({
    message: 'Could not connect to mint',
    text: 'Check your connection or try again later.',
    icon: 'icon:feather:wifi',
    type: 'error',
    ...overrides,
  });
}

export function couldNotCancelPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Could not cancel',
    icon: 'icon:mdi:close-circle',
    type: 'error',
    ...overrides,
  });
}

export function operationInvalidStatePopup(
  params: { state: string },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Cannot check operation status',
    text: `Operation is in "${params.state}" state.`,
    icon: 'icon:mdi:alert-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function invalidNostrTransportPopup(): void {
  popup({
    message: 'Invalid payment request',
    text: 'No Nostr transport found.',
    icon: 'icon:feather:wifi',
    type: 'error',
  });
}

export function invalidRecipientPopup(): void {
  popup({
    message: 'Invalid recipient in payment request',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  });
}

export function noLightningAddressPopup(): void {
  popup({
    message: 'No lightning address provided',
    icon: 'icon:mingcute:lightning-fill',
    type: 'error',
  });
}

export function quoteCreationFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to create quote',
    icon: 'icon:mdi:alert-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function noPaymentRequestPopup(): void {
  popup({
    message: 'No payment request provided',
    icon: 'icon:mdi:alert-circle-outline',
    type: 'error',
  });
}

/** For coco-payment-ux NO_AMOUNT. */
export function noAmountPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Amount Required',
    text: 'Please enter an amount.',
    icon: 'icon:mdi:currency-usd',
    type: 'error',
    ...overrides,
  });
}

/** For coco-payment-ux UNSUPPORTED_INPUT. */
export function unsupportedInputPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Unsupported Input',
    text: 'This input format is not supported.',
    icon: 'icon:mdi:alert-circle-outline',
    type: 'error',
    ...overrides,
  });
}

/** For coco-payment-ux ALL_OPTIONS_DISABLED. */
export function allOptionsDisabledPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'No Options Available',
    text: 'All payment options are disabled.',
    icon: 'icon:mdi:alert-circle-outline',
    type: 'warning',
    ...overrides,
  });
}

/** For coco-payment-ux MISSING_MELT_TARGET. */
export function missingMeltTargetPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Missing Payment Target',
    text: 'A Lightning invoice or address is required for this flow.',
    icon: 'icon:mingcute:lightning-fill',
    type: 'error',
    ...overrides,
  });
}
