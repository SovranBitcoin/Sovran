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
      icon: 'icon:mdi:bank',
      type: 'success',
      ...overrides,
    });
  }
}

export function noMintSelectedPopup(overrides?: BaseOverrides): void {
  popup({ message: 'No mint selected', icon: 'icon:mdi:bank', type: 'error', ...overrides });
}

/** For coco-payment-ux NO_VALID_MINT — no mint supports this payment. */
export function noValidMintPopup(overrides?: TextOverrides): void {
  popup({
    message: 'No Valid Mint',
    text: 'No mint is available for this payment.',
    icon: 'icon:mdi:bank',
    type: 'error',
    ...overrides,
  });
}

export function noMintsSelectedPopup(): void {
  popup({
    message: 'Please select at least one mint to add',
    icon: 'icon:mdi:bank',
    type: 'warning',
  });
}

export function mintsAddFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to add mints',
    icon: 'icon:mdi:bank',
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

export function recoverySuccessPopup(
  params: { mintCount: number; durationSec: string },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Recovery Complete',
    text: `Recovered from ${params.mintCount} mint${params.mintCount !== 1 ? 's' : ''} in ${params.durationSec}s.`,
    icon: 'icon:mdi:shield-check',
    type: 'success',
    ...overrides,
  });
}

export function recoveryPartialPopup(
  params: { successCount: number; failureCount: number },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Recovery Partial',
    text: `Recovered from ${params.successCount}, failed for ${params.failureCount}.`,
    icon: 'icon:mdi:shield',
    type: 'warning',
    ...overrides,
  });
}

export function recoveryFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Recovery Failed',
    text: 'An error occurred during recovery.',
    icon: 'icon:mdi:shield-remove',
    type: 'error',
    ...overrides,
  });
}
