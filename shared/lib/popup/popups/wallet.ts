import { makeStaticPopup, makeParamPopup } from './factory';

const WALLET_ICON = 'icon:solar:wallet-bold';

export const insufficientBalancePopup = makeParamPopup<{
  amount: number;
  unit: string;
  fee: number;
}>(({ amount, unit, fee }) => ({
  message: 'Insufficient Balance',
  text: `Not enough funds to send ${amount} ${unit} with a fee of ${fee} ${unit}.`,
  icon: WALLET_ICON,
  type: 'error',
}));

/** For coco-payment-ux INSUFFICIENT_BALANCE / NO_BALANCE when amount/unit/fee are not available. */
export const balanceTooLowPopup = makeStaticPopup({
  message: 'Insufficient Balance',
  text: 'You do not have enough funds to complete this transaction.',
  icon: WALLET_ICON,
  type: 'error',
});

export const invalidAddressPopup = makeParamPopup<{ address: string }>(({ address }) => ({
  message: 'Invalid Address',
  text: `The address "${address}" is not a valid Ecash or Lightning address.`,
  icon: 'icon:lucide:link',
  type: 'error',
}));

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
