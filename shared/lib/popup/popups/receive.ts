import { popup } from '../engine';
import type { TextOverrides } from './types';

export function receiveFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to receive ecash',
    icon: 'icon:ri:close-circle-line',
    type: 'error',
    ...overrides,
  });
}

export function noUnitSetPopup(): void {
  popup({ message: 'No unit set', icon: 'icon:mdi:alert-circle', type: 'error' });
}

export function unsupportedTokenUnitPopup(params: { unit: string }): void {
  popup({
    message: 'Unsupported Token Unit',
    text: `"${params.unit}" tokens cannot be redeemed. Only sat tokens are supported.`,
    icon: 'icon:mdi:currency-usd',
    type: 'error',
  });
}

export function receiveMintUpdatedPopup(): void {
  popup({ message: 'Receive mint updated', icon: 'icon:mdi:bank', type: 'success' });
}

export function receiveMintUpdateFailedPopup(): void {
  popup({ message: 'Failed to update receive mint', icon: 'icon:mdi:bank', type: 'error' });
}
