import { makeStaticPopup, makeParamPopup } from './factory';

const WALLET_ICON = 'icon:solar:wallet-bold';

export const invalidTokenPopup = makeStaticPopup({
  message: 'Invalid token',
  icon: 'icon:mdi:ticket-percent',
  type: 'error',
});

export const noWalletAvailablePopup = makeStaticPopup({
  message: 'No wallet available',
  icon: WALLET_ICON,
  type: 'error',
});

export const noApiKeyPopup = makeStaticPopup({
  message: 'No API key configured',
  text: 'Please set up your AI credit key.',
  icon: 'icon:solar:key-bold',
  type: 'error',
});

export const sendMessageFailedPopup = makeStaticPopup({
  message: 'Failed to send message',
  text: 'Please try again.',
  icon: 'icon:mdi:message-text',
  type: 'error',
});

export const balanceRefreshedPopup = makeParamPopup<{ balance: string }>(({ balance }) => ({
  message: `Balance refreshed: ${balance}`,
  icon: WALLET_ICON,
  type: 'success',
}));

export const balanceRefreshFailedPopup = makeStaticPopup({
  message: 'Failed to refresh balance',
  icon: WALLET_ICON,
  type: 'error',
});

export const modelSwitchedPopup = makeParamPopup<{ modelName: string }>(({ modelName }) => ({
  message: `Switched to ${modelName}`,
  icon: 'icon:mdi:robot',
  type: 'success',
}));

export const photoPickerComingSoonPopup = makeStaticPopup({
  message: 'Photo picker coming soon',
  icon: 'icon:mdi:camera',
  type: 'info',
});
