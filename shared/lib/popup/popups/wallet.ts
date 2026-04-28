import { popup } from '../engine';
import type { BaseOverrides, TextOverrides } from './types';

export function insufficientBalancePopup(params: {
  amount: number;
  unit: string;
  fee: number;
}): void {
  popup({
    message: 'Insufficient Balance',
    text: `Not enough funds to send ${params.amount} ${params.unit} with a fee of ${params.fee} ${params.unit}.`,
    icon: 'icon:solar:wallet-bold',
    type: 'error',
  });
}

/** For coco-payment-ux INSUFFICIENT_BALANCE / NO_BALANCE when amount/unit/fee are not available. */
export function balanceTooLowPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Insufficient Balance',
    text: 'You do not have enough funds to complete this transaction.',
    icon: 'icon:solar:wallet-bold',
    type: 'error',
    ...overrides,
  });
}

export function invalidAddressPopup(params: { address: string }): void {
  popup({
    message: 'Invalid Address',
    text: `The address "${params.address}" is not a valid Ecash or Lightning address.`,
    icon: 'icon:lucide:link',
    type: 'error',
  });
}

export function noClipboardAddressPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'No Address Found',
    text: 'No valid address was found in your clipboard.',
    icon: 'icon:mdi:alert-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function reservedProofsFreedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Reserved proofs freed',
    icon: 'icon:mdi:shield-check',
    type: 'success',
    ...overrides,
  });
}

export function reservedProofsFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to free reserved proofs',
    icon: 'icon:mdi:shield',
    type: 'error',
    ...overrides,
  });
}
