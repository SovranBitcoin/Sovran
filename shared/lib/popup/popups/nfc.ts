import { makeStaticPopup, makeParamPopup } from './factory';

export const walletNotReadyPopup = makeStaticPopup({
  message: 'Wallet not ready',
  text: 'Please try again.',
  icon: 'icon:solar:wallet-bold',
  type: 'error',
});

export const nfcErrorPopup = makeParamPopup<{ title: string; message: string }>(
  ({ title, message }) => ({
    message: title,
    text: message,
    icon: 'icon:lucide:nfc',
    type: 'error',
  })
);
