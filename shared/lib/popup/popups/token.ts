import { makeStaticPopup, makeParamPopup } from './factory';

export const tokenRedeemedPopup = makeStaticPopup({
  message: 'Token Redeemed',
  text: 'All proofs are spent — the recipient has claimed this token.',
  icon: 'icon:mdi:check-circle',
  type: 'success',
});

export const tokenAlreadyRedeemedPopup = makeStaticPopup({
  message: 'Token Already Redeemed',
  text: 'All proofs are spent — the recipient already claimed it. Nothing to reclaim.',
  icon: 'icon:mdi:information',
  type: 'info',
});

export const tokenStillPendingPopup = makeStaticPopup({
  message: 'Token Still Pending',
  text: 'All proofs are unspent — the recipient has not claimed this token yet. You can cancel to reclaim the funds.',
  icon: 'icon:mdi:clock-outline',
  type: 'info',
});

export const tokenMixedStatesPopup = makeParamPopup<{
  spent: number;
  unspent: number;
  pending: number;
  total: number;
}>(({ spent, unspent, pending, total }) => ({
  message: 'Mixed Proof States',
  text: `${spent}/${total} spent, ${unspent}/${total} unspent, ${pending}/${total} pending.`,
  icon: 'icon:mdi:alert-circle-outline',
  type: 'warning',
}));

export const tokenCheckFailedPopup = makeStaticPopup({
  message: 'Check Status Failed',
  text: 'Unable to check the token status.',
  icon: 'icon:mdi:alert-circle',
  type: 'error',
});

export const tokenCannotCancelPopup = makeStaticPopup({
  message: 'Cannot Cancel',
  text: 'No operation ID and no token available to reclaim.',
  icon: 'icon:mdi:cancel',
  type: 'warning',
});

export const tokenCannotReclaimPopup = makeStaticPopup({
  message: 'Cannot Reclaim Yet',
  text: 'All proofs are in a pending state at the mint. Try again shortly.',
  icon: 'icon:mdi:clock-alert-outline',
  type: 'warning',
});

export const fundsReclaimedPopup = makeParamPopup<{ amount: number; unit: string }>(
  ({ amount, unit }) => ({
    message: 'Funds Reclaimed',
    text: `${amount} ${unit} reclaimed back into your wallet.`,
    icon: 'icon:mdi:cash-multiple',
    type: 'success',
  })
);

export const reclaimFailedPopup = makeStaticPopup({
  message: 'Reclaim Failed',
  icon: 'icon:mdi:cash-multiple',
  type: 'error',
});

export const tokenCannotCheckStatusPopup = makeStaticPopup({
  message: 'Cannot Check Status',
  text: 'No operation ID and no token available to verify.',
  icon: 'icon:mdi:help-circle',
  type: 'warning',
});

export const tokenRedeemedByRecipientPopup = makeStaticPopup({
  message: 'Token was redeemed by recipient',
  icon: 'icon:mdi:check-circle',
  type: 'success',
});

export const tokenPendingNotRedeemedPopup = makeStaticPopup({
  message: 'Token is still pending - not yet redeemed',
  icon: 'icon:mdi:clock-outline',
  type: 'info',
});

export const transactionAlreadyCancelledPopup = makeStaticPopup({
  message: 'Transaction was already cancelled',
  icon: 'icon:mdi:information',
  type: 'info',
});

export const transactionCancelledPopup = makeStaticPopup({
  message: 'Transaction cancelled successfully',
  icon: 'icon:mdi:check-circle-outline',
});
