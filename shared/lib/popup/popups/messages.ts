import { popup } from '../engine';
import type { TextOverrides } from './types';

export function invalidTokenPopup(): void {
  popup({ message: 'Invalid token', icon: 'icon:mdi:ticket-alert', type: 'error' });
}

export function noWalletAvailablePopup(): void {
  popup({ message: 'No wallet available', icon: 'icon:mdi:wallet-outline', type: 'error' });
}

export function noApiKeyPopup(): void {
  popup({
    message: 'No API key configured',
    text: 'Please set up your Routstr API key.',
    icon: 'icon:solar:key-bold',
    type: 'error',
  });
}

export function sendMessageFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to send message',
    text: 'Please try again.',
    icon: 'icon:mdi:message-alert',
    type: 'error',
    ...overrides,
  });
}

export function balanceRefreshedPopup(params: { balance: string }): void {
  popup({
    message: `Balance refreshed: ${params.balance}`,
    icon: 'icon:mdi:wallet-check',
    type: 'success',
  });
}

export function balanceRefreshFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to refresh balance',
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
    ...overrides,
  });
}

export function modelSwitchedPopup(params: { modelName: string }): void {
  popup({ message: `Switched to ${params.modelName}`, icon: 'icon:mdi:robot', type: 'success' });
}

export function photoPickerComingSoonPopup(): void {
  popup({ message: 'Photo picker coming soon', icon: 'icon:mdi:camera-plus', type: 'info' });
}
