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
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
  });
}

export function invalidAddressPopup(params: { address: string }): void {
  popup({
    message: 'Invalid Address',
    text: `The address "${params.address}" is not a valid Ecash or Lightning address.`,
    icon: 'icon:mdi:link-off',
    type: 'error',
  });
}

export function noClipboardAddressPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'No Address Found',
    text: 'No valid address was found in your clipboard.',
    icon: 'icon:mdi:clipboard-off-outline',
    type: 'error',
    ...overrides,
  });
}

export function reservedProofsFreedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Reserved proofs freed',
    icon: 'icon:mdi:lock-open-variant',
    type: 'success',
    ...overrides,
  });
}

export function reservedProofsFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to free reserved proofs',
    icon: 'icon:mdi:lock-alert',
    type: 'error',
    ...overrides,
  });
}
