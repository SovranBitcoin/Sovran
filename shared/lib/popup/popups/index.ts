import type { ReactNode } from 'react';
import { popup } from './engine';
import type { PopupOverrides } from './types';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';

export type { CopyTarget } from './copy';
export { copyPopup } from './copy';
export { profileSwitcherPopup } from './actionSheets';
export { paymentOptionsPopup, paymentFallbackPopup } from './paymentOptionsSheet';
export { proofSelectorPopup } from './proofSelectorSheet';
export { sendMemoPopup } from './sendMemoSheet';
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
const BANK_ICON = 'icon:mingcute:bank-fill';
const WALLET_ICON = 'icon:solar:wallet-bold';
const ALERT_ICON = 'icon:mdi:alert-circle-outline';
const CAMERA_ICON = 'icon:mdi:camera';
const QR_ICON = 'icon:mdi:qrcode';

type PopupSpec = {
  message: string;
  text?: string | ReactNode | PopupTextSegment[];
  icon?: PopupIcon;
  type?: 'success' | 'error' | 'warning' | 'info';
  variant?: 'toast' | 'sheet';
  buttons?: { text: string; page?: string; onPress?: () => void }[];
};

const STATIC_POPUPS = {
  // auth
  'key-generated': { message: 'New key generated', icon: KEY_ICON, type: 'success' },
  'key-generate-failed': { message: 'Failed to generate key', icon: KEY_ICON, type: 'error' },
  'keys-load-failed': { message: 'Failed to load keys', icon: KEY_ICON, type: 'error' },
  'key-imported': { message: 'Key imported successfully', icon: KEY_ICON, type: 'success' },
  'key-import-failed': { message: 'Failed to import key', icon: KEY_ICON, type: 'error' },

  // mint
  'no-mint-selected': { message: 'No mint selected', icon: BANK_ICON, type: 'error' },
  'no-valid-mint': {
    message: 'No mint available',
    text: 'No mint is available for this payment.',
    icon: BANK_ICON,
    type: 'error',
  },
  'no-mints-selected': {
    message: 'Please select at least one mint to add',
    icon: BANK_ICON,
    type: 'warning',
  },
  'mints-add-failed': { message: 'Failed to add mints', icon: BANK_ICON, type: 'error' },
  'manager-not-initialized': {
    message: 'Manager not initialized',
    text: 'Please try again.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  },
  'recovery-failed': {
    message: 'Recovery failed',
    text: 'An error occurred during recovery.',
    icon: 'icon:mdi:shield-remove',
    type: 'error',
  },

  // general
  'general-error': {
    message: 'Something went wrong',
    text: 'Please try again.',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  },
  'copy-failed': { message: 'Failed to copy', icon: ALERT_ICON, type: 'error' },
  'open-link-failed': {
    message: 'Failed to open link',
    icon: 'icon:lucide:link',
    type: 'error',
  },
  'wallet-still-loading': {
    message: 'Wallet is still loading',
    text: 'Please wait for the wallet to finish loading before switching profiles.',
    icon: 'icon:mdi:clock-outline',
    type: 'info',
  },

  // send
  'send-payment-failed': {
    message: 'Failed to send payment',
    icon: 'icon:mdi:send',
    type: 'error',
  },
  'cancel-transaction-failed': {
    message: 'Failed to cancel transaction',
    icon: 'icon:mdi:close-circle',
    type: 'error',
  },
  'cancel-transaction-offline': {
    message: 'Cannot cancel while offline',
    text: 'This action is not possible while offline. Connect to the internet and try again.',
    icon: 'icon:feather:wifi-off',
    type: 'warning',
  },
  'operation-not-found': {
    message: 'Operation not found',
    icon: 'icon:majesticons:search-line',
    type: 'error',
  },
  'mint-unreachable': {
    message: 'Could not connect to mint',
    text: 'Check your connection or try again later.',
    icon: 'icon:feather:wifi',
    type: 'error',
  },
  'could-not-cancel': {
    message: 'Could not cancel',
    icon: 'icon:mdi:close-circle',
    type: 'error',
  },
  'no-amount': {
    message: 'Amount required',
    text: 'Please enter an amount.',
    icon: 'icon:mdi:currency-usd',
    type: 'error',
  },
  'unsupported-input': {
    message: 'Unsupported input',
    text: 'This input format is not supported.',
    icon: ALERT_ICON,
    type: 'error',
  },
  'unsupported-payment-method': {
    message: 'Payment method not available',
    text: 'This payment method is not available for the selected mint.',
    icon: ALERT_ICON,
    type: 'warning',
  },
  'all-options-disabled': {
    message: 'No options available',
    text: 'All payment options are disabled.',
    icon: ALERT_ICON,
    type: 'warning',
  },
  'missing-melt-target': {
    message: 'Missing payment target',
    text: 'A Lightning invoice or address is required for this flow.',
    icon: 'icon:mingcute:lightning-fill',
    type: 'error',
  },

  // receive
  'receive-failed': {
    message: 'Failed to receive ecash',
    icon: 'icon:ri:close-circle-line',
    type: 'error',
  },
  'receive-mint-updated': {
    message: 'Receive mint updated',
    icon: BANK_ICON,
    type: 'success',
  },
  'receive-mint-update-failed': {
    message: 'Failed to update receive mint',
    icon: BANK_ICON,
    type: 'error',
  },

  // messages
  'invalid-token': {
    message: 'Invalid token',
    icon: 'icon:mdi:ticket-percent',
    type: 'error',
  },
  'no-wallet-available': { message: 'No wallet available', icon: WALLET_ICON, type: 'error' },
  'no-api-key': {
    message: 'No API key configured',
    text: 'Please set up your AI credit key.',
    icon: KEY_ICON,
    type: 'error',
  },
  'send-message-failed': {
    message: 'Failed to send message',
    text: 'Please try again.',
    icon: 'icon:mdi:message-text',
    type: 'error',
  },

  // token
  'token-redeemed-by-recipient': {
    message: 'Recipient redeemed your token',
    icon: 'icon:mdi:check-circle',
    type: 'success',
  },
  'token-pending-not-redeemed': {
    message: 'Token is still pending — not yet redeemed',
    icon: 'icon:mdi:clock-outline',
    type: 'info',
  },
  'transaction-already-cancelled': {
    message: 'Transaction was already cancelled',
    icon: 'icon:mdi:information',
    type: 'info',
  },
  'transaction-cancelled': {
    message: 'Transaction cancelled successfully',
    icon: 'icon:mdi:check-circle-outline',
  },

  // wallet
  'balance-too-low': {
    message: 'Insufficient balance',
    text: 'You do not have enough funds to complete this transaction.',
    icon: WALLET_ICON,
    type: 'error',
  },
  'no-clipboard-address': {
    message: 'No address found',
    text: 'No valid address was found in your clipboard.',
    icon: ALERT_ICON,
    type: 'error',
  },
  'reserved-proofs-freed': {
    message: 'Funds returned to your balance',
    icon: 'icon:mdi:shield-check',
    type: 'success',
  },
  'reserved-proofs-failed': {
    message: 'Could not return your funds',
    icon: 'icon:mdi:shield',
    type: 'error',
  },

  // routstr
  'routstr-transaction-failed': {
    message: 'AI transaction failed',
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  },

  // qr
  'no-qr-code-found': {
    message: 'No QR code found in image',
    icon: QR_ICON,
    type: 'info',
  },
  'qr-scan-failed': {
    message: 'Failed to scan QR code from image',
    icon: QR_ICON,
    type: 'error',
  },

  // dev
  'deeplink-failed': {
    message: 'Failed to process link',
    icon: 'icon:lucide:link',
    type: 'error',
  },
} as const satisfies Record<string, PopupSpec>;

const PARAM_POPUPS = {
  'mints-added': (p: { added: number; failed?: number }): PopupSpec =>
    p.failed && p.failed > 0
      ? {
          message: `Added ${p.added}, ${p.failed} failed`,
          icon: ALERT_ICON,
          type: 'warning',
        }
      : {
          message: `Successfully added ${p.added} mint(s)`,
          icon: BANK_ICON,
          type: 'success',
        },

  'recovery-success': (p: { mintCount: number; durationSec: string }): PopupSpec => ({
    message: 'Recovery complete',
    text: `Recovered from ${p.mintCount} mint${p.mintCount !== 1 ? 's' : ''} in ${p.durationSec}s.`,
    icon: 'icon:mdi:shield-check',
    type: 'success',
  }),

  'recovery-partial': (p: { successCount: number; failureCount: number }): PopupSpec => ({
    message: 'Partial recovery',
    text: `Recovered from ${p.successCount}, failed for ${p.failureCount}.`,
    icon: 'icon:mdi:shield',
    type: 'warning',
  }),

  'new-version': (p: { version: string }): PopupSpec => ({
    message: 'New version available',
    text: `A new version (${p.version}) is available. Please update to the latest version.`,
    icon: 'icon:mdi:download',
    variant: 'sheet',
  }),

  'engagement-update-failed': (action: 'follow' | 'like' | 'repost'): PopupSpec => ({
    message: `Unable to update ${action} right now`,
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  }),

  'operation-invalid-state': (p: { state: string }): PopupSpec => ({
    message: 'Cannot check operation status',
    text: `Operation is in "${p.state}" state.`,
    icon: ALERT_ICON,
    type: 'error',
  }),

  'unsupported-token-unit': (p: { unit: string }): PopupSpec => ({
    message: 'Unsupported token',
    text: `This token is in "${p.unit}". Only Bitcoin (sat) tokens can be received.`,
    icon: 'icon:mdi:currency-usd',
    type: 'error',
  }),

  'model-switched': (p: { modelName: string }): PopupSpec => ({
    message: `Switched to ${p.modelName}`,
    icon: 'icon:mdi:robot',
    type: 'success',
  }),

  'routstr-top-up-success': (p: { balance: string }): PopupSpec => ({
    message: `Balance topped up! New balance: ${p.balance}`,
    icon: WALLET_ICON,
    type: 'success',
  }),

  'routstr-wallet-created': (p: { balance: string }): PopupSpec => ({
    message: `Wallet created! Balance: ${p.balance}`,
    icon: WALLET_ICON,
    type: 'success',
  }),

  'camera-permission': (status: 'granted' | 'denied' | 'blocked'): PopupSpec => {
    if (status === 'granted') {
      return {
        message: 'Camera permission granted',
        text: 'Camera access has been granted.',
        icon: CAMERA_ICON,
        type: 'success',
      };
    }
    if (status === 'denied') {
      return {
        message: 'Camera permission denied',
        text: 'Camera access is denied. Please enable it in your device settings.',
        icon: CAMERA_ICON,
        type: 'error',
      };
    }
    return {
      message: 'Camera permission blocked',
      text: 'Camera access is blocked. Please enable it in your device settings.',
      icon: CAMERA_ICON,
      buttons: [{ text: 'Open settings', page: 'settings' }],
      type: 'error',
    };
  },

  'nfc-error': (p: { title: string; message: string }): PopupSpec => ({
    message: p.title,
    text: p.message,
    icon: 'icon:lucide:nfc',
    type: 'error',
  }),

  /** Generic "this action can't run" toast with caller-supplied wording —
   *  e.g. Send Money on a profile without a Lightning address. */
  'action-unavailable': (p: { title: string; message: string }): PopupSpec => ({
    message: p.title,
    text: p.message,
    icon: 'icon:mdi:alert-circle',
    type: 'error',
  }),

  'dev-mode': (enabled: boolean): PopupSpec => ({
    message: enabled ? 'Developer mode enabled' : 'Developer mode disabled',
    icon: 'icon:material-symbols:report-rounded',
    type: 'success',
  }),

  'rollback-success': (p: { count: number }): PopupSpec => ({
    message: `Successfully rolled back ${p.count} transaction${p.count !== 1 ? 's' : ''}`,
    icon: 'icon:mdi:cash-multiple',
    type: 'success',
  }),

  'rollback-partial': (p: { success: number; failed: number; total: number }): PopupSpec => ({
    message: `Rolled back ${p.success}, failed ${p.failed}`,
    icon: ALERT_ICON,
    type: p.failed === p.total ? 'error' : 'warning',
  }),
} as const satisfies Record<string, (p: never) => PopupSpec>;

export type StaticPopupKey = keyof typeof STATIC_POPUPS;
export type ParamPopupKey = keyof typeof PARAM_POPUPS;
export type PopupParams<K extends ParamPopupKey> = Parameters<(typeof PARAM_POPUPS)[K]>[0];

export function staticPopup(key: StaticPopupKey, overrides?: PopupOverrides): void {
  popup({ ...STATIC_POPUPS[key], ...overrides });
}

export function paramPopup<K extends ParamPopupKey>(
  key: K,
  params: PopupParams<K>,
  overrides?: PopupOverrides
): void {
  const build = PARAM_POPUPS[key] as (p: PopupParams<K>) => PopupSpec;
  popup({ ...build(params), ...overrides });
}
