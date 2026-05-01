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
    ? `AI wallet initialized! Balance: ${params.balance}`
    : 'AI wallet initialized! You can now chat with the AI.';
  popup({ message, icon: 'icon:mingcute:lightning-fill', type: 'success' });
}

export function routstrTransactionFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'AI transaction failed',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}
