import { popup } from '../engine';
import type { BaseOverrides, TextOverrides } from './types';

export function mintsAddedPopup(
  params: { added: number; failed?: number },
  overrides?: BaseOverrides
): void {
  if (params.failed && params.failed > 0) {
    popup({
      message: `Added ${params.added}, ${params.failed} failed`,
      icon: 'icon:mdi:alert-circle-outline',
      type: 'warning',
      ...overrides,
    });
  } else {
    popup({
      message: `Successfully added ${params.added} mint(s)`,
      icon: 'icon:mdi:bank-check',
      type: 'success',
      ...overrides,
    });
  }
}

export function noMintSelectedPopup(overrides?: BaseOverrides): void {
  popup({ message: 'No mint selected', icon: 'icon:mdi:bank-off', type: 'error', ...overrides });
}

/** For coco-payment-ux NO_VALID_MINT — no mint supports this payment. */
export function noValidMintPopup(overrides?: TextOverrides): void {
  popup({
    message: 'No Valid Mint',
    text: 'No mint is available for this payment.',
    icon: 'icon:mdi:bank-off',
    type: 'error',
    ...overrides,
  });
}

export function noMintsSelectedPopup(): void {
  popup({
    message: 'Please select at least one mint to add',
    icon: 'icon:mdi:bank-off',
    type: 'warning',
  });
}

export function mintsAddFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to add mints',
    icon: 'icon:mdi:bank-remove',
    type: 'error',
    ...overrides,
  });
}

export function managerNotInitializedPopup(): void {
  popup({
    message: 'Manager not initialized',
    text: 'Please try again.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  });
}
