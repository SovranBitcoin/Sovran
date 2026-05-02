import { makeStaticPopup, makeParamPopup } from './factory';

const WALLET_ICON = 'icon:solar:wallet-bold';

export const routstrTopUpSuccessPopup = makeParamPopup<{ balance: string }>(({ balance }) => ({
  message: `Balance topped up! New balance: ${balance}`,
  icon: WALLET_ICON,
  type: 'success',
}));

export const routstrWalletCreatedPopup = makeParamPopup<{ balance: string }>(({ balance }) => ({
  message: `Wallet created! Balance: ${balance}`,
  icon: WALLET_ICON,
  type: 'success',
}));

export const routstrInitializedPopup = makeParamPopup<{ balance?: string } | undefined>(
  (params) => ({
    message: params?.balance
      ? `AI wallet initialized! Balance: ${params.balance}`
      : 'AI wallet initialized! You can now chat with the AI.',
    icon: 'icon:mingcute:lightning-fill',
    type: 'success',
  })
);

export const routstrTransactionFailedPopup = makeStaticPopup({
  message: 'AI transaction failed',
  icon: 'icon:mdi:alert-circle',
  type: 'error',
});
