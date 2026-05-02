import { makeStaticPopup, makeParamPopup } from './factory';

const BANK_ICON = 'icon:mdi:bank';

export const receiveFailedPopup = makeStaticPopup({
  message: 'Failed to receive ecash',
  icon: 'icon:ri:close-circle-line',
  type: 'error',
});

export const noUnitSetPopup = makeStaticPopup({
  message: 'No unit set',
  icon: 'icon:mdi:alert-circle',
  type: 'error',
});

export const unsupportedTokenUnitPopup = makeParamPopup<{ unit: string }>(({ unit }) => ({
  message: 'Unsupported Token Unit',
  text: `"${unit}" tokens cannot be redeemed. Only sat tokens are supported.`,
  icon: 'icon:mdi:currency-usd',
  type: 'error',
}));

export const receiveMintUpdatedPopup = makeStaticPopup({
  message: 'Receive mint updated',
  icon: BANK_ICON,
  type: 'success',
});

export const receiveMintUpdateFailedPopup = makeStaticPopup({
  message: 'Failed to update receive mint',
  icon: BANK_ICON,
  type: 'error',
});
