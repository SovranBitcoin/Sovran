import { popup } from '../engine';
import type { BaseOverrides, TextOverrides } from './types';

export function invalidPaymentRequestPopup(): void {
  popup({ message: 'Invalid payment request', icon: 'icon:mdi:file-alert-outline', type: 'error' });
}

export function sendPaymentFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to send payment',
    icon: 'icon:mdi:send-clock',
    type: 'error',
    ...overrides,
  });
}

export function cancelTransactionFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to cancel transaction',
    icon: 'icon:mdi:close-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function operationNotFoundPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Operation not found',
    icon: 'icon:mdi:file-search-outline',
    type: 'error',
    ...overrides,
  });
}

export function couldNotCancelPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Could not cancel',
    icon: 'icon:mdi:close-circle-outline',
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
    icon: 'icon:mdi:connection',
    type: 'error',
  });
}

export function invalidRecipientPopup(): void {
  popup({
    message: 'Invalid recipient in payment request',
    icon: 'icon:mdi:account-alert',
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
    icon: 'icon:mdi:file-alert-outline',
    type: 'error',
    ...overrides,
  });
}

export function noPaymentRequestPopup(): void {
  popup({
    message: 'No payment request provided',
    icon: 'icon:mdi:file-alert-outline',
    type: 'error',
  });
}
