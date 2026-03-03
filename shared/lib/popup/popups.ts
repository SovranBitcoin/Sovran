import type { ReactNode } from 'react';
import { popup } from './engine';
import type { PopupIcon } from './icons';
import type { PopupTextSegment } from './format';

// ---------------------------------------------------------------------------
// Shared override types
// ---------------------------------------------------------------------------

type BaseOverrides = {
  duration?: number;
  onClose?: (data: unknown) => void;
};

type TextOverrides = BaseOverrides & {
  text?: string | ReactNode | PopupTextSegment[];
};

type PopupOverrides = TextOverrides & {
  icon?: PopupIcon;
};

// ---------------------------------------------------------------------------
// Copy popups
// ---------------------------------------------------------------------------

const COPY_CONFIGS = {
  ecashToken: {
    title: 'Token Copied',
    text: 'Ecash token has been copied to your clipboard.',
  },
  npub: {
    title: 'NPUB Copied',
    text: 'Nostr public key has been copied to your clipboard.',
  },
  nsec: {
    title: 'NSEC Copied',
    text: 'Nostr secret key has been copied to your clipboard.',
  },
  p2pk: {
    title: 'P2PK Key Copied',
    text: 'P2PK public key has been copied to your clipboard.',
  },
  mnemonic: {
    title: 'Mnemonic Copied',
    text: 'Recovery phrase has been copied to your clipboard.',
  },
  cashuMnemonic: {
    title: 'Cashu Mnemonic Copied',
    text: 'Cashu recovery phrase has been copied to your clipboard.',
  },
  lightningAddress: {
    title: 'Address Copied',
    text: 'Lightning address has been copied to your clipboard.',
  },
  publicKey: {
    title: 'Public Key Copied',
    text: 'Public key has been copied to your clipboard.',
  },
  nip05: {
    title: 'NIP-05 Copied',
    text: 'NIP-05 address has been copied to your clipboard.',
  },
  lud16: {
    title: 'Lightning Address Copied',
    text: 'Lightning address has been copied to your clipboard.',
  },
} as const;

export type CopyTarget = keyof typeof COPY_CONFIGS;

export function copyPopup(target: CopyTarget, overrides?: BaseOverrides): void {
  const config = COPY_CONFIGS[target];
  popup({ message: config.title, text: config.text, type: 'success', ...overrides });
}

// ---------------------------------------------------------------------------
// Funds / payment popups
// ---------------------------------------------------------------------------

export function sendSuccessPopup(overrides?: PopupOverrides): void {
  popup({
    message: 'Funds Sent',
    text: 'Funds have been sent successfully.',
    icon: 'icon:mdi:send-check',
    type: 'success',
    ...overrides,
  });
}

export function receiveSuccessPopup(
  params: { amount: number; unit: string },
  overrides?: PopupOverrides
): void {
  popup({
    message: 'Funds Received',
    text: `${params.amount} ${params.unit} has been added to your wallet.`,
    icon: 'icon:mdi:call-received',
    type: 'success',
    ...overrides,
  });
}

export function nostrPaymentSentPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Payment sent successfully via Nostr',
    icon: 'icon:mdi:send-check',
    type: 'success',
    ...overrides,
  });
}

export function paymentCancelledPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Payment cancelled',
    icon: 'icon:mdi:close-circle-outline',
    type: 'success',
    text: 'Reserved proofs have been freed.',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// NFC popups
// ---------------------------------------------------------------------------

export function nfcEcashSharedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Ecash Token Shared via NFC',
    text: 'Ecash token has been shared via NFC.',
    icon: 'icon:mdi:nfc',
    type: 'success',
    ...overrides,
  });
}

export function nfcPaymentSentPopup(options: {
  text?: string | PopupTextSegment[];
  icon?: PopupIcon;
  duration?: number;
  onClose?: (data: unknown) => void;
}): void {
  popup({
    message: 'Payment sent',
    text: options.text,
    variant: 'sheet',
    icon: options.icon ?? 'icon:mdi:send-check',
    duration: options.duration ?? 2600,
    onClose: options.onClose,
  });
}

export function nfcConnectionLostPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'NFC connection lost. Send was rolled back.',
    icon: 'icon:mdi:wifi-off',
    type: 'warning',
    ...overrides,
  });
}

export function nfcSendFailedPopup(options?: { text?: string; rollbackFailed?: boolean }): void {
  popup({
    message: options?.rollbackFailed ? 'NFC send failed and rollback failed' : 'NFC send failed',
    text: options?.text,
    icon: 'icon:mdi:nfc-off',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// Token status popups (send flow)
// ---------------------------------------------------------------------------

export function tokenRedeemedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Token Redeemed',
    text: 'All proofs are spent — the recipient has claimed this token.',
    icon: 'icon:mdi:check-circle',
    type: 'success',
    ...overrides,
  });
}

export function tokenAlreadyRedeemedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Token Already Redeemed',
    text: 'All proofs are spent — the recipient already claimed it. Nothing to reclaim.',
    icon: 'icon:mdi:information-outline',
    type: 'info',
    ...overrides,
  });
}

export function tokenStillPendingPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Token Still Pending',
    text: 'All proofs are unspent — the recipient has not claimed this token yet. You can cancel to reclaim the funds.',
    icon: 'icon:mdi:clock-outline',
    type: 'info',
    ...overrides,
  });
}

export function tokenMixedStatesPopup(
  params: { spent: number; unspent: number; pending: number; total: number },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Mixed Proof States',
    text: `${params.spent}/${params.total} spent, ${params.unspent}/${params.total} unspent, ${params.pending}/${params.total} pending.`,
    icon: 'icon:mdi:alert-circle-outline',
    type: 'warning',
    ...overrides,
  });
}

export function tokenCheckFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Check Status Failed',
    text: 'Unable to check the token status.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}

export function tokenCannotCancelPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Cannot Cancel',
    text: 'No operation ID and no token available to reclaim.',
    icon: 'icon:mdi:cancel',
    type: 'warning',
    ...overrides,
  });
}

export function tokenCannotReclaimPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Cannot Reclaim Yet',
    text: 'All proofs are in a pending state at the mint. Try again shortly.',
    icon: 'icon:mdi:clock-alert-outline',
    type: 'warning',
    ...overrides,
  });
}

export function fundsReclaimedPopup(
  params: { amount: number; unit: string },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Funds Reclaimed',
    text: `${params.amount} ${params.unit} reclaimed back into your wallet.`,
    icon: 'icon:mdi:cash-refund',
    type: 'success',
    ...overrides,
  });
}

export function reclaimFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Reclaim Failed',
    icon: 'icon:mdi:cash-remove',
    type: 'error',
    ...overrides,
  });
}

export function tokenCannotCheckStatusPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Cannot Check Status',
    text: 'No operation ID and no token available to verify.',
    icon: 'icon:mdi:help-circle-outline',
    type: 'warning',
    ...overrides,
  });
}

export function tokenRedeemedByRecipientPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Token was redeemed by recipient',
    icon: 'icon:mdi:check-circle',
    type: 'success',
    ...overrides,
  });
}

export function tokenPendingNotRedeemedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Token is still pending - not yet redeemed',
    icon: 'icon:mdi:clock-outline',
    type: 'info',
    ...overrides,
  });
}

export function transactionAlreadyCancelledPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Transaction was already cancelled',
    icon: 'icon:mdi:information-outline',
    type: 'info',
    ...overrides,
  });
}

export function transactionCancelledPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Transaction cancelled successfully',
    icon: 'icon:mdi:check-circle-outline',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Camera permission popups
// ---------------------------------------------------------------------------

export function cameraPermissionPopup(
  status: 'granted' | 'denied' | 'blocked',
  overrides?: BaseOverrides
): void {
  if (status === 'granted') {
    popup({
      message: 'Camera Permission Granted',
      text: 'Camera access has been granted.',
      icon: 'icon:mdi:camera-check',
      type: 'success',
      ...overrides,
    });
  } else if (status === 'denied') {
    popup({
      message: 'Camera Permission Denied',
      text: 'Camera access is denied. Please enable it in your device settings.',
      icon: 'icon:mdi:camera-off',
      type: 'error',
      ...overrides,
    });
  } else {
    popup({
      message: 'Camera Permission Blocked',
      text: 'Camera access is blocked. Please enable it in your device settings.',
      icon: 'icon:mdi:camera-lock',
      buttons: [{ text: 'Open Settings', page: 'settings' }],
      type: 'error',
      ...overrides,
    });
  }
}

// ---------------------------------------------------------------------------
// Balance & address popups
// ---------------------------------------------------------------------------

export function insufficientBalancePopup(params: {
  amount: number;
  unit: string;
  fee: number;
}): void {
  popup({
    message: 'Insufficient Balance',
    text: `Not enough funds to send ${params.amount} ${params.unit} with a fee of ${params.fee} ${params.unit}.`,
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
  });
}

export function invalidAddressPopup(params: { address: string }): void {
  popup({
    message: 'Invalid Address',
    text: `The address "${params.address}" is not a valid Ecash or Lightning address.`,
    icon: 'icon:mdi:link-off',
    type: 'error',
  });
}

export function noClipboardAddressPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'No Address Found',
    text: 'No valid address was found in your clipboard.',
    icon: 'icon:mdi:clipboard-off-outline',
    type: 'error',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Reserved proofs popups
// ---------------------------------------------------------------------------

export function reservedProofsFreedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Reserved proofs freed',
    icon: 'icon:mdi:lock-open-variant',
    type: 'success',
    ...overrides,
  });
}

export function reservedProofsFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to free reserved proofs',
    icon: 'icon:mdi:lock-alert',
    type: 'error',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Key management popups
// ---------------------------------------------------------------------------

export function keyGeneratedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'New key generated',
    type: 'success',
    icon: 'icon:solar:key-bold',
    ...overrides,
  });
}

export function keyGenerateFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to generate key',
    icon: 'icon:mdi:key-alert',
    type: 'error',
    ...overrides,
  });
}

export function keysLoadFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to load keys',
    icon: 'icon:mdi:key-alert',
    type: 'error',
    ...overrides,
  });
}

export function keyImportedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Key imported successfully',
    type: 'success',
    icon: 'icon:solar:key-bold',
    ...overrides,
  });
}

export function keyImportFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to import key',
    icon: 'icon:mdi:key-remove',
    type: 'error',
    ...overrides,
  });
}

export function invalidKeyFormatPopup(): void {
  popup({
    message: 'Invalid Key Format',
    text: 'Enter nsec or 64-character hex key.',
    icon: 'icon:mdi:key-remove',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// Mint popups
// ---------------------------------------------------------------------------

export function mintsAddedPopup(
  params: { added: number; failed?: number },
  overrides?: BaseOverrides
): void {
  if (params.failed && params.failed > 0) {
    popup({
      message: `Added ${params.added}, ${params.failed} failed`,
      icon: 'icon:mdi:alert-circle-outline',
      type: 'warning',
      ...overrides,
    });
  } else {
    popup({
      message: `Successfully added ${params.added} mint(s)`,
      icon: 'icon:mdi:bank-check',
      type: 'success',
      ...overrides,
    });
  }
}

export function noMintSelectedPopup(overrides?: BaseOverrides): void {
  popup({ message: 'No mint selected', icon: 'icon:mdi:bank-off', type: 'error', ...overrides });
}

export function noMintsSelectedPopup(): void {
  popup({
    message: 'Please select at least one mint to add',
    icon: 'icon:mdi:bank-off',
    type: 'warning',
  });
}

export function mintsAddFailedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Failed to add mints',
    icon: 'icon:mdi:bank-remove',
    type: 'error',
    ...overrides,
  });
}

export function managerNotInitializedPopup(): void {
  popup({
    message: 'Manager not initialized',
    text: 'Please try again.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// App status popups
// ---------------------------------------------------------------------------

export function notImplementedPopup(): void {
  popup({
    message: 'Not Implemented',
    text: 'This feature is not yet implemented.',
    icon: 'icon:mdi:hammer-wrench',
    type: 'info',
  });
}

export function comingSoonPopup(): void {
  popup({
    message: 'Coming Soon',
    text: 'This feature is currently under development.',
    icon: 'icon:mdi:hammer-wrench',
    type: 'info',
  });
}

export function generalErrorPopup(overrides?: PopupOverrides): void {
  popup({
    message: 'Error Occurred',
    text: 'Something went wrong. Please try again.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}

export function newVersionPopup(params: { version: string }): void {
  popup({
    message: 'New Version Available',
    text: `A new version (${params.version}) is available. Please update to the latest version.`,
    icon: 'icon:mdi:cellphone-arrow-down',
    variant: 'sheet',
  });
}

export function passcodeNotMatchPopup(): void {
  popup({
    message: 'Passcode Not Match',
    text: 'The passcode does not match. Please try again.',
    icon: 'icon:mdi:lock-alert',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// Clipboard & link popups
// ---------------------------------------------------------------------------

export function copyFailedPopup(): void {
  popup({ message: 'Failed to copy', icon: 'icon:mdi:clipboard-alert-outline', type: 'error' });
}

export function openLinkFailedPopup(): void {
  popup({ message: 'Failed to open link', icon: 'icon:mdi:link-off', type: 'error' });
}

// ---------------------------------------------------------------------------
// Engagement popups (follow / like / repost)
// ---------------------------------------------------------------------------

export function engagementUpdateFailedPopup(action: 'follow' | 'like' | 'repost'): void {
  popup({
    message: `Unable to update ${action} right now`,
    icon: 'icon:mdi:account-alert',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// Send & payment error popups
// ---------------------------------------------------------------------------

export function invalidPaymentRequestPopup(): void {
  popup({ message: 'Invalid payment request', icon: 'icon:mdi:file-alert-outline', type: 'error' });
}

export function sendPaymentFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to send payment',
    icon: 'icon:mdi:send-clock',
    type: 'error',
    ...overrides,
  });
}

export function cancelTransactionFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to cancel transaction',
    icon: 'icon:mdi:close-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function operationNotFoundPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Operation not found',
    icon: 'icon:mdi:file-search-outline',
    type: 'error',
    ...overrides,
  });
}

export function couldNotCancelPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Could not cancel',
    icon: 'icon:mdi:close-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function operationInvalidStatePopup(
  params: { state: string },
  overrides?: BaseOverrides
): void {
  popup({
    message: 'Cannot check operation status',
    text: `Operation is in "${params.state}" state.`,
    icon: 'icon:mdi:alert-circle-outline',
    type: 'error',
    ...overrides,
  });
}

export function invalidNostrTransportPopup(): void {
  popup({
    message: 'Invalid payment request',
    text: 'No Nostr transport found.',
    icon: 'icon:mdi:connection',
    type: 'error',
  });
}

export function invalidRecipientPopup(): void {
  popup({
    message: 'Invalid recipient in payment request',
    icon: 'icon:mdi:account-alert',
    type: 'error',
  });
}

export function noLightningAddressPopup(): void {
  popup({
    message: 'No lightning address provided',
    icon: 'icon:mingcute:lightning-fill',
    type: 'error',
  });
}

export function noPaymentRequestPopup(): void {
  popup({
    message: 'No payment request provided',
    icon: 'icon:mdi:file-alert-outline',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// Receive popups
// ---------------------------------------------------------------------------

export function receiveFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to receive ecash',
    icon: 'icon:mdi:call-missed',
    type: 'error',
    ...overrides,
  });
}

export function noUnitSetPopup(): void {
  popup({ message: 'No unit set', icon: 'icon:mdi:alert-circle', type: 'error' });
}

export function unsupportedTokenUnitPopup(params: { unit: string }): void {
  popup({
    message: 'Unsupported Token Unit',
    text: `"${params.unit}" tokens cannot be redeemed. Only sat tokens are supported.`,
    icon: 'icon:mdi:currency-usd-off',
    type: 'error',
  });
}

export function receiveMintUpdatedPopup(): void {
  popup({ message: 'Receive mint updated', icon: 'icon:mdi:bank-check', type: 'success' });
}

export function receiveMintUpdateFailedPopup(): void {
  popup({ message: 'Failed to update receive mint', icon: 'icon:mdi:bank-remove', type: 'error' });
}

// ---------------------------------------------------------------------------
// NFC error popups
// ---------------------------------------------------------------------------

export function walletNotReadyPopup(): void {
  popup({
    message: 'Wallet not ready',
    text: 'Please try again.',
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
  });
}

/** Renders a dynamic NFC error from `getNfcErrorMessage()`. */
export function nfcErrorPopup(params: { title: string; message: string }): void {
  popup({ message: params.title, text: params.message, icon: 'icon:mdi:nfc-off', type: 'error' });
}

// ---------------------------------------------------------------------------
// Camera & QR popups
// ---------------------------------------------------------------------------

export function noQrCodeFoundPopup(): void {
  popup({ message: 'No QR code found in image', icon: 'icon:mdi:qrcode-remove', type: 'info' });
}

export function qrScanFailedPopup(): void {
  popup({
    message: 'Failed to scan QR code from image',
    icon: 'icon:mdi:qrcode-remove',
    type: 'error',
  });
}

// ---------------------------------------------------------------------------
// Messages / AI popups
// ---------------------------------------------------------------------------

export function invalidTokenPopup(): void {
  popup({ message: 'Invalid token', icon: 'icon:mdi:ticket-alert', type: 'error' });
}

export function noWalletAvailablePopup(): void {
  popup({ message: 'No wallet available', icon: 'icon:mdi:wallet-outline', type: 'error' });
}

export function noApiKeyPopup(): void {
  popup({
    message: 'No API key configured',
    text: 'Please set up your Routstr API key.',
    icon: 'icon:solar:key-bold',
    type: 'error',
  });
}

export function sendMessageFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to send message',
    text: 'Please try again.',
    icon: 'icon:mdi:message-alert',
    type: 'error',
    ...overrides,
  });
}

export function balanceRefreshedPopup(params: { balance: string }): void {
  popup({
    message: `Balance refreshed: ${params.balance}`,
    icon: 'icon:mdi:wallet-check',
    type: 'success',
  });
}

export function balanceRefreshFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to refresh balance',
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
    ...overrides,
  });
}

export function modelSwitchedPopup(params: { modelName: string }): void {
  popup({ message: `Switched to ${params.modelName}`, icon: 'icon:mdi:robot', type: 'success' });
}

export function photoPickerComingSoonPopup(): void {
  popup({ message: 'Photo picker coming soon', icon: 'icon:mdi:camera-plus', type: 'info' });
}

// ---------------------------------------------------------------------------
// Routstr popups
// ---------------------------------------------------------------------------

export function routstrTopUpSuccessPopup(params: { balance: string }): void {
  popup({
    message: `Balance topped up! New balance: ${params.balance}`,
    icon: 'icon:mdi:wallet-plus',
    type: 'success',
  });
}

export function routstrWalletCreatedPopup(params: { balance: string }): void {
  popup({
    message: `Wallet created! Balance: ${params.balance}`,
    icon: 'icon:mdi:wallet-plus',
    type: 'success',
  });
}

export function routstrInitializedPopup(params?: { balance?: string }): void {
  const message = params?.balance
    ? `Routstr wallet initialized! Balance: ${params.balance}`
    : 'Routstr wallet initialized! You can now use Routstr AI.';
  popup({ message, icon: 'icon:mdi:rocket-launch', type: 'success' });
}

export function routstrTransactionFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to process Routstr transaction',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Dev mode popups
// ---------------------------------------------------------------------------

export function devModePopup(enabled: boolean): void {
  popup({
    message: enabled ? 'Developer mode enabled' : 'Developer mode disabled',
    icon: 'icon:mdi:bug',
    type: 'success',
  });
}

// ---------------------------------------------------------------------------
// Deeplink popups
// ---------------------------------------------------------------------------

export function deeplinkFailedPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Failed to process link',
    icon: 'icon:mdi:link-off',
    type: 'error',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Pending ecash popups
// ---------------------------------------------------------------------------

export function rollbackSuccessPopup(params: { count: number }, overrides?: BaseOverrides): void {
  popup({
    message: `Successfully rolled back ${params.count} transaction${params.count !== 1 ? 's' : ''}`,
    icon: 'icon:mdi:cash-refund',
    type: 'success',
    ...overrides,
  });
}

export function rollbackPartialPopup(params: {
  success: number;
  failed: number;
  total: number;
}): void {
  popup({
    message: `Rolled back ${params.success}, failed ${params.failed}`,
    icon: 'icon:mdi:alert-circle-outline',
    type: params.failed === params.total ? 'error' : 'warning',
  });
}
