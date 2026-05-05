import { makeStaticPopup } from './factory';

const WALLET_ICON = 'icon:solar:wallet-bold';

/** For coco-payment-ux INSUFFICIENT_BALANCE / NO_BALANCE when amount/unit/fee are not available. */
export const balanceTooLowPopup = makeStaticPopup({
  message: 'Insufficient Balance',
  text: 'You do not have enough funds to complete this transaction.',
  icon: WALLET_ICON,
  type: 'error',
});

export const noClipboardAddressPopup = makeStaticPopup({
  message: 'No Address Found',
  text: 'No valid address was found in your clipboard.',
  icon: 'icon:mdi:alert-circle-outline',
  type: 'error',
});

export const reservedProofsFreedPopup = makeStaticPopup({
  message: 'Reserved proofs freed',
  icon: 'icon:mdi:shield-check',
  type: 'success',
});

export const reservedProofsFailedPopup = makeStaticPopup({
  message: 'Failed to free reserved proofs',
  icon: 'icon:mdi:shield',
  type: 'error',
});
