import { popup } from '../engine';
import type { BaseOverrides, TextOverrides } from './types';

export function tokenRedeemedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Token Redeemed',
    text: 'All proofs are spent — the recipient has claimed this token.',
    icon: 'icon:mdi:check-circle',
    type: 'success',
    ...overrides,
  });
}

export function tokenAlreadyRedeemedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Token Already Redeemed',
    text: 'All proofs are spent — the recipient already claimed it. Nothing to reclaim.',
    icon: 'icon:mdi:information-outline',
    type: 'info',
    ...overrides,
  });
}

export function tokenStillPendingPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Token Still Pending',
    text: 'All proofs are unspent — the recipient has not claimed this token yet. You can cancel to reclaim the funds.',
    icon: 'icon:mdi:clock-outline',
    type: 'info',
    ...overrides,
  });
}

export function tokenMixedStatesPopup(
  params: { spent: number; unspent: number; pending: number; total: number },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Mixed Proof States',
    text: `${params.spent}/${params.total} spent, ${params.unspent}/${params.total} unspent, ${params.pending}/${params.total} pending.`,
    icon: 'icon:mdi:alert-circle-outline',
    type: 'warning',
    ...overrides,
  });
}

export function tokenCheckFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Check Status Failed',
    text: 'Unable to check the token status.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}

export function tokenCannotCancelPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Cannot Cancel',
    text: 'No operation ID and no token available to reclaim.',
    icon: 'icon:mdi:cancel',
    type: 'warning',
    ...overrides,
  });
}

export function tokenCannotReclaimPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Cannot Reclaim Yet',
    text: 'All proofs are in a pending state at the mint. Try again shortly.',
    icon: 'icon:mdi:clock-alert-outline',
    type: 'warning',
    ...overrides,
  });
}

export function fundsReclaimedPopup(
  params: { amount: number; unit: string },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Funds Reclaimed',
    text: `${params.amount} ${params.unit} reclaimed back into your wallet.`,
    icon: 'icon:mdi:cash-refund',
    type: 'success',
    ...overrides,
  });
}

export function reclaimFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Reclaim Failed',
    icon: 'icon:mdi:cash-remove',
    type: 'error',
    ...overrides,
  });
}

export function tokenCannotCheckStatusPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Cannot Check Status',
    text: 'No operation ID and no token available to verify.',
    icon: 'icon:mdi:help-circle-outline',
    type: 'warning',
    ...overrides,
  });
}

export function tokenRedeemedByRecipientPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Token was redeemed by recipient',
    icon: 'icon:mdi:check-circle',
    type: 'success',
    ...overrides,
  });
}

export function tokenPendingNotRedeemedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Token is still pending - not yet redeemed',
    icon: 'icon:mdi:clock-outline',
    type: 'info',
    ...overrides,
  });
}

export function transactionAlreadyCancelledPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Transaction was already cancelled',
    icon: 'icon:mdi:information-outline',
    type: 'info',
    ...overrides,
  });
}

export function transactionCancelledPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Transaction cancelled successfully',
    icon: 'icon:mdi:check-circle-outline',
    ...overrides,
  });
}
