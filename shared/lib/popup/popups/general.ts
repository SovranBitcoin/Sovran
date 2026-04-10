import { popup } from '../engine';
import type { PopupOverrides } from './types';

export function notImplementedPopup(): void {
  popup({
    message: 'Not Implemented',
    text: 'This feature is not yet implemented.',
    icon: 'icon:mdi:hammer-wrench',
    type: 'info',
  });
}

export function comingSoonPopup(): void {
  popup({
    message: 'Coming Soon',
    text: 'This feature is currently under development.',
    icon: 'icon:mdi:hammer-wrench',
    type: 'info',
  });
}

export function generalErrorPopup(overrides?: PopupOverrides): void {
  popup({
    message: 'Error Occurred',
    text: 'Something went wrong. Please try again.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}

export function newVersionPopup(params: { version: string }): void {
  popup({
    message: 'New Version Available',
    text: `A new version (${params.version}) is available. Please update to the latest version.`,
    icon: 'icon:mdi:cellphone-arrow-down',
    variant: 'sheet',
  });
}

export function copyFailedPopup(): void {
  popup({ message: 'Failed to copy', icon: 'icon:mdi:clipboard-alert-outline', type: 'error' });
}

export function openLinkFailedPopup(): void {
  popup({ message: 'Failed to open link', icon: 'icon:mdi:link-off', type: 'error' });
}

export function walletStillLoadingPopup(): void {
  popup({
    message: 'Wallet is still loading',
    text: 'Please wait for the wallet to finish loading before switching profiles.',
    icon: 'icon:mdi:timer-sand',
    type: 'info',
  });
}

export function engagementUpdateFailedPopup(action: 'follow' | 'like' | 'repost'): void {
  popup({
    message: `Unable to update ${action} right now`,
    icon: 'icon:mdi:account-alert',
    type: 'error',
  });
}
