import { makeStaticPopup, makeParamPopup } from './factory';

const BANK_ICON = 'icon:mdi:bank';

export const mintsAddedPopup = makeParamPopup<{ added: number; failed?: number }>(
  ({ added, failed }) =>
    failed && failed > 0
      ? {
          message: `Added ${added}, ${failed} failed`,
          icon: 'icon:mdi:alert-circle-outline',
          type: 'warning',
        }
      : {
          message: `Successfully added ${added} mint(s)`,
          icon: BANK_ICON,
          type: 'success',
        }
);

export const noMintSelectedPopup = makeStaticPopup({
  message: 'No mint selected',
  icon: BANK_ICON,
  type: 'error',
});

/** For coco-payment-ux NO_VALID_MINT — no mint supports this payment. */
export const noValidMintPopup = makeStaticPopup({
  message: 'No Valid Mint',
  text: 'No mint is available for this payment.',
  icon: BANK_ICON,
  type: 'error',
});

export const noMintsSelectedPopup = makeStaticPopup({
  message: 'Please select at least one mint to add',
  icon: BANK_ICON,
  type: 'warning',
});

export const mintsAddFailedPopup = makeStaticPopup({
  message: 'Failed to add mints',
  icon: BANK_ICON,
  type: 'error',
});

export const managerNotInitializedPopup = makeStaticPopup({
  message: 'Manager not initialized',
  text: 'Please try again.',
  icon: 'icon:mdi:alert-circle',
  type: 'error',
});

export const recoverySuccessPopup = makeParamPopup<{ mintCount: number; durationSec: string }>(
  ({ mintCount, durationSec }) => ({
    message: 'Recovery Complete',
    text: `Recovered from ${mintCount} mint${mintCount !== 1 ? 's' : ''} in ${durationSec}s.`,
    icon: 'icon:mdi:shield-check',
    type: 'success',
  })
);

export const recoveryPartialPopup = makeParamPopup<{
  successCount: number;
  failureCount: number;
}>(({ successCount, failureCount }) => ({
  message: 'Recovery Partial',
  text: `Recovered from ${successCount}, failed for ${failureCount}.`,
  icon: 'icon:mdi:shield',
  type: 'warning',
}));

export const recoveryFailedPopup = makeStaticPopup({
  message: 'Recovery Failed',
  text: 'An error occurred during recovery.',
  icon: 'icon:mdi:shield-remove',
  type: 'error',
});
