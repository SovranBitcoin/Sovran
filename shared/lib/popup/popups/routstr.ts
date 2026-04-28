import { popup } from '../engine';
import type { TextOverrides } from './types';

export function routstrTopUpSuccessPopup(params: { balance: string }): void {
  popup({
    message: `Balance topped up! New balance: ${params.balance}`,
    icon: 'icon:solar:wallet-bold',
    type: 'success',
  });
}

export function routstrWalletCreatedPopup(params: { balance: string }): void {
  popup({
    message: `Wallet created! Balance: ${params.balance}`,
    icon: 'icon:solar:wallet-bold',
    type: 'success',
  });
}

export function routstrInitializedPopup(params?: { balance?: string }): void {
  const message = params?.balance
    ? `Routstr wallet initialized! Balance: ${params.balance}`
    : 'Routstr wallet initialized! You can now use Routstr AI.';
  popup({ message, icon: 'icon:mingcute:lightning-fill', type: 'success' });
}

export function routstrTransactionFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to process Routstr transaction',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}
