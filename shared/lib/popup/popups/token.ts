import { makeStaticPopup } from './factory';

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
