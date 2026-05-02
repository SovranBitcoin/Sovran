import { makeStaticPopup, makeParamPopup } from './factory';

export const notImplementedPopup = makeStaticPopup({
  message: 'Not Implemented',
  text: 'This feature is not yet implemented.',
  icon: 'icon:mdi:hammer-wrench',
  type: 'info',
});

export const comingSoonPopup = makeStaticPopup({
  message: 'Coming Soon',
  text: 'This feature is currently under development.',
  icon: 'icon:mdi:hammer-wrench',
  type: 'info',
});

export const generalErrorPopup = makeStaticPopup({
  message: 'Error Occurred',
  text: 'Something went wrong. Please try again.',
  icon: 'icon:mdi:alert-circle',
  type: 'error',
});

export const newVersionPopup = makeParamPopup<{ version: string }>(({ version }) => ({
  message: 'New Version Available',
  text: `A new version (${version}) is available. Please update to the latest version.`,
  icon: 'icon:mdi:download',
  variant: 'sheet',
}));

export const copyFailedPopup = makeStaticPopup({
  message: 'Failed to copy',
  icon: 'icon:mdi:alert-circle-outline',
  type: 'error',
});

export const openLinkFailedPopup = makeStaticPopup({
  message: 'Failed to open link',
  icon: 'icon:lucide:link',
  type: 'error',
});

export const walletStillLoadingPopup = makeStaticPopup({
  message: 'Wallet is still loading',
  text: 'Please wait for the wallet to finish loading before switching profiles.',
  icon: 'icon:mdi:clock-outline',
  type: 'info',
});

export const engagementUpdateFailedPopup = makeParamPopup<'follow' | 'like' | 'repost'>(
  (action) => ({
    message: `Unable to update ${action} right now`,
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  })
);
