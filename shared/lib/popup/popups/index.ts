import { makeStaticPopup, makeParamPopup } from './factory';

export type { CopyTarget } from './copy';
export { copyPopup } from './copy';
export {
  profileSwitcherPopup,
  proofSelectorPopup,
  paymentOptionsPopup,
  paymentFallbackPopup,
} from './actionSheets';
export { emojiPickerPopup } from './emojiPicker';
export { modelPickerPopup } from './modelPicker';
export type { ProfileSwitcherAction } from '../actionSheetTypes';
export { actionMenuPopup, dismissActionMenuPopup } from './actionMenu';
export {
  paymentStatusPopup,
  swapStatusPopup,
  isSwapStatusToastMounted,
  paymentCancelledPopup,
  nfcEcashSharedPopup,
  nfcConnectionLostPopup,
  nfcSendFailedPopup,
} from './payment';

const KEY_ICON = 'icon:solar:key-bold';
const BANK_ICON = 'icon:mdi:bank';
const WALLET_ICON = 'icon:solar:wallet-bold';
const ALERT_ICON = 'icon:mdi:alert-circle-outline';
const CAMERA_ICON = 'icon:mdi:camera';
const QR_ICON = 'icon:mdi:qrcode';

// ─── auth ──────────────────────────────────────────────────────────────────────

export const keyGeneratedPopup = makeStaticPopup({
  message: 'New key generated',
  icon: KEY_ICON,
  type: 'success',
});

export const keyGenerateFailedPopup = makeStaticPopup({
  message: 'Failed to generate key',
  icon: KEY_ICON,
  type: 'error',
});

export const keysLoadFailedPopup = makeStaticPopup({
  message: 'Failed to load keys',
  icon: KEY_ICON,
  type: 'error',
});

export const keyImportedPopup = makeStaticPopup({
  message: 'Key imported successfully',
  icon: KEY_ICON,
  type: 'success',
});

export const keyImportFailedPopup = makeStaticPopup({
  message: 'Failed to import key',
  icon: KEY_ICON,
  type: 'error',
});

// ─── mint ──────────────────────────────────────────────────────────────────────

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

// ─── general ───────────────────────────────────────────────────────────────────

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

// ─── send ──────────────────────────────────────────────────────────────────────

export const sendPaymentFailedPopup = makeStaticPopup({
  message: 'Failed to send payment',
  icon: 'icon:mdi:send',
  type: 'error',
});

export const cancelTransactionFailedPopup = makeStaticPopup({
  message: 'Failed to cancel transaction',
  icon: 'icon:mdi:close-circle',
  type: 'error',
});

export const operationNotFoundPopup = makeStaticPopup({
  message: 'Operation not found',
  icon: 'icon:majesticons:search-line',
  type: 'error',
});

export const mintUnreachablePopup = makeStaticPopup({
  message: 'Could not connect to mint',
  text: 'Check your connection or try again later.',
  icon: 'icon:feather:wifi',
  type: 'error',
});

export const couldNotCancelPopup = makeStaticPopup({
  message: 'Could not cancel',
  icon: 'icon:mdi:close-circle',
  type: 'error',
});

export const operationInvalidStatePopup = makeParamPopup<{ state: string }>(({ state }) => ({
  message: 'Cannot check operation status',
  text: `Operation is in "${state}" state.`,
  icon: ALERT_ICON,
  type: 'error',
}));

/** For coco-payment-ux NO_AMOUNT. */
export const noAmountPopup = makeStaticPopup({
  message: 'Amount Required',
  text: 'Please enter an amount.',
  icon: 'icon:mdi:currency-usd',
  type: 'error',
});

/** For coco-payment-ux UNSUPPORTED_INPUT. */
export const unsupportedInputPopup = makeStaticPopup({
  message: 'Unsupported Input',
  text: 'This input format is not supported.',
  icon: ALERT_ICON,
  type: 'error',
});

/** For coco-payment-ux ALL_OPTIONS_DISABLED. */
export const allOptionsDisabledPopup = makeStaticPopup({
  message: 'No Options Available',
  text: 'All payment options are disabled.',
  icon: ALERT_ICON,
  type: 'warning',
});

/** For coco-payment-ux MISSING_MELT_TARGET. */
export const missingMeltTargetPopup = makeStaticPopup({
  message: 'Missing Payment Target',
  text: 'A Lightning invoice or address is required for this flow.',
  icon: 'icon:mingcute:lightning-fill',
  type: 'error',
});

// ─── receive ───────────────────────────────────────────────────────────────────

export const receiveFailedPopup = makeStaticPopup({
  message: 'Failed to receive ecash',
  icon: 'icon:ri:close-circle-line',
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

// ─── messages ──────────────────────────────────────────────────────────────────

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

export const modelSwitchedPopup = makeParamPopup<{ modelName: string }>(({ modelName }) => ({
  message: `Switched to ${modelName}`,
  icon: 'icon:mdi:robot',
  type: 'success',
}));

// ─── token ─────────────────────────────────────────────────────────────────────

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

// ─── wallet ────────────────────────────────────────────────────────────────────

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

// ─── routstr ───────────────────────────────────────────────────────────────────

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

export const routstrTransactionFailedPopup = makeStaticPopup({
  message: 'AI transaction failed',
  icon: 'icon:mdi:alert-circle',
  type: 'error',
});

// ─── camera ────────────────────────────────────────────────────────────────────

export const cameraPermissionPopup = makeParamPopup<'granted' | 'denied' | 'blocked'>((status) => {
  if (status === 'granted') {
    return {
      message: 'Camera Permission Granted',
      text: 'Camera access has been granted.',
      icon: CAMERA_ICON,
      type: 'success',
    };
  }
  if (status === 'denied') {
    return {
      message: 'Camera Permission Denied',
      text: 'Camera access is denied. Please enable it in your device settings.',
      icon: CAMERA_ICON,
      type: 'error',
    };
  }
  return {
    message: 'Camera Permission Blocked',
    text: 'Camera access is blocked. Please enable it in your device settings.',
    icon: CAMERA_ICON,
    buttons: [{ text: 'Open Settings', page: 'settings' }],
    type: 'error',
  };
});

export const noQrCodeFoundPopup = makeStaticPopup({
  message: 'No QR code found in image',
  icon: QR_ICON,
  type: 'info',
});

export const qrScanFailedPopup = makeStaticPopup({
  message: 'Failed to scan QR code from image',
  icon: QR_ICON,
  type: 'error',
});

// ─── nfc ───────────────────────────────────────────────────────────────────────

export const nfcErrorPopup = makeParamPopup<{ title: string; message: string }>(
  ({ title, message }) => ({
    message: title,
    text: message,
    icon: 'icon:lucide:nfc',
    type: 'error',
  })
);

// ─── dev ───────────────────────────────────────────────────────────────────────

export const devModePopup = makeParamPopup<boolean>((enabled) => ({
  message: enabled ? 'Developer mode enabled' : 'Developer mode disabled',
  icon: 'icon:material-symbols:report-rounded',
  type: 'success',
}));

export const deeplinkFailedPopup = makeStaticPopup({
  message: 'Failed to process link',
  icon: 'icon:lucide:link',
  type: 'error',
});

// ─── pending ───────────────────────────────────────────────────────────────────

export const rollbackSuccessPopup = makeParamPopup<{ count: number }>(({ count }) => ({
  message: `Successfully rolled back ${count} transaction${count !== 1 ? 's' : ''}`,
  icon: 'icon:mdi:cash-multiple',
  type: 'success',
}));

export const rollbackPartialPopup = makeParamPopup<{
  success: number;
  failed: number;
  total: number;
}>(({ success, failed, total }) => ({
  message: `Rolled back ${success}, failed ${failed}`,
  icon: 'icon:mdi:alert-circle-outline',
  type: failed === total ? 'error' : 'warning',
}));
