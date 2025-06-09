import { SheetManager } from 'react-native-actions-sheet';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React from 'react';
import { formatAmount } from 'helper/currency';
import { Text } from 'components/common/Themed';
import { AmountFormatter } from 'components/common/AmountFormatter';

const MESSAGE_TYPES = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  SUCCESS: 'success',
};

const MESSAGE_EMOJIS = {
  [MESSAGE_TYPES.ERROR]: '🚨',
  [MESSAGE_TYPES.WARNING]: '⚠️',
  [MESSAGE_TYPES.INFO]: '💡',
  [MESSAGE_TYPES.SUCCESS]: '🎉',
};

type MessageText = string | React.ReactNode | ((params: any) => React.ReactNode);

type MessageConfig = {
  title: string;
  text: MessageText;
  type: string;
  buttons?: any; // Make button optional
};

const MESSAGE_CONFIGS: Record<string, MessageConfig> = {
  // Authentication & Permissions
  ecash_token_copied: {
    title: 'Token Copied',
    text: 'Ecash token has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  npub_copied: {
    title: 'NPUB Copied',
    text: 'Nostr public key has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  nsec_copied: {
    title: 'NSEC Copied',
    text: 'Nostr secret key has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  vpn_copied: {
    title: 'VPN Details Copied',
    text: 'VPN configuration has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  unified_address_copied: {
    title: 'Unified Address Copied',
    text: 'Unified address has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  lightning_address_copied: {
    title: 'Address Copied',
    text: 'Lightning address has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  payment_request_copied: {
    title: 'Ecash Payment Request Copied',
    text: 'Ecash Payment request has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  invalid_token: {
    title: 'Invalid Token',
    text: 'The token format is invalid or corrupted.',
    type: MESSAGE_TYPES.ERROR,
  },
  token_expired: {
    title: 'Token Expired',
    text: 'This token has expired and cannot be used.',
    type: MESSAGE_TYPES.WARNING,
  },
  payment_info_copy_failed: {
    title: 'Copy Failed',
    text: 'Unable to copy payment information. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },

  clipboard_permission_denied: {
    title: 'Permission Required',
    text: 'Please enable clipboard access in your device settings to use this feature.',
    type: MESSAGE_TYPES.ERROR,
  },
  camera_permission_denied: {
    title: 'Camera Access Required',
    text: 'Please enable camera access in your device settings to use this feature.',
    type: MESSAGE_TYPES.ERROR,
  },
  sharing_unavailable: {
    title: 'Sharing Unavailable',
    text: 'Sharing is not supported on your device.',
    type: MESSAGE_TYPES.WARNING,
  },

  // Balance & Transactions
  insufficient_balance: {
    title: 'Insufficient Balance',
    text: ({ amount, unit, fee }: { amount: number; unit: string; fee: number }) => (
      <Text
        style={{
          textAlign: 'center',
        }}>
        Not enough funds to send{' '}
        <AmountFormatter
          style={{
            marginBottom: -4,
            marginLeft: 3,
          }}
          size={14}
          amount={amount}
          unit={unit}
        />{' '}
        with a fee of{' '}
        <AmountFormatter
          style={{
            marginBottom: -4,
            marginLeft: 3,
          }}
          size={14}
          amount={fee}
          unit={unit}
        />
        .
      </Text>
    ),
    type: MESSAGE_TYPES.ERROR,
  },
  funds_received: {
    title: 'Funds Received',
    text: ({ amount, unit }: { amount: number; unit: string }) =>
      `${amount} ${unit} has been added to your wallet.`,
    type: MESSAGE_TYPES.SUCCESS,
  },
  funds_sent: {
    title: 'Transfer Complete',
    text: ({ amount, unit }: { amount: number; unit: string }) =>
      `${amount} ${unit} has been sent successfully.`,
    type: MESSAGE_TYPES.SUCCESS,
  },
  ecash_transaction_pending: {
    title: 'Transaction Pending',
    text: 'Your transaction is pending. Please wait for the receiver to redeem the ecash token.',
    type: MESSAGE_TYPES.INFO,
  },
  lightning_transaction_pending: {
    title: 'Transaction Pending',
    text: 'Your transaction is pending. Please wait for the receiver to send the payment.',
    type: MESSAGE_TYPES.INFO,
  },
  no_initial_balance: {
    title: 'Deposit Required',
    text: ({ unit }: { unit: string }) =>
      `Please add funds to your ${unit.toUpperCase()} account before making transfers.`,
    type: MESSAGE_TYPES.WARNING,
  },
  unsupported_currency: {
    title: 'Unsupported Currency',
    text: ({ unit }: { unit: string }) =>
      `The mint does not support the currency "${unit.toUpperCase()}". Please choose a different currency or different mint.`,
    type: MESSAGE_TYPES.ERROR,
  },
  pending_ecash_transaction: {
    title: 'Pending reason',
    text: 'Ecash transactions will remain pending until the receiver has scanned and *redeemed* your ecash token.',
    type: MESSAGE_TYPES.INFO,
  },

  // Address & Payment Requests
  invalid_address: {
    title: 'Invalid Address',
    text: ({ address }: { address: string }) =>
      `The address "${address}" is not a valid Ecash or Lightning address.`,
    type: MESSAGE_TYPES.ERROR,
  },
  no_clipboard_address: {
    title: 'No Address Found',
    text: 'No valid address was found in your clipboard.',
    type: MESSAGE_TYPES.WARNING,
  },
  invalid_payment_request: {
    title: 'Invalid Payment Request',
    text: 'The payment request is missing required information.',
    type: MESSAGE_TYPES.ERROR,
  },
  missing_amount: {
    title: 'Amount Required',
    text: 'The payment request does not specify an amount.',
    type: MESSAGE_TYPES.ERROR,
  },
  missing_mint: {
    title: 'Mint Required',
    text: 'The payment request does not specify a mint.',
    type: MESSAGE_TYPES.ERROR,
  },

  // eSIM Related
  esim_error: {
    title: 'eSIM Not Found',
    text: 'Unable to locate eSIMs. Please try again later.',
    type: MESSAGE_TYPES.ERROR,
  },
  esim_link_copied: {
    title: 'eSIM Link Copied',
    text: 'The eSIM link has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },

  // System & General
  general_error: {
    title: 'Error Occurred',
    text: 'Something went wrong. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  mint_update_failed: {
    title: 'Update Failed',
    text: 'Unable to update the mint. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  download_failed: {
    title: 'Download Failed',
    text: 'Unable to complete the download. Please check your connection and try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  feature_coming_soon: {
    title: 'Coming Soon',
    text: 'This feature is currently under development.',
    type: MESSAGE_TYPES.INFO,
  },
  already_redeemed: {
    title: 'Already Redeemed',
    text: 'This token has already been redeemed. Each token can only be used once per user.',
    type: MESSAGE_TYPES.WARNING,
  },
  not_implemented: {
    title: 'Not Implemented',
    text: 'This feature is not yet implemented.',
    type: MESSAGE_TYPES.INFO,
  },

  startup_warning: {
    title: 'Warning',
    text:
      'Do not use with large amounts of ecash. Sovran wallet is operated on a best-effort basis and without any guarantees',
    type: MESSAGE_TYPES.WARNING,
  },

  'outputs have already been signed before.': {
    title: 'Outputs have been signed before',
    text: 'Fix this in the debug settings',
    buttons: [
      {
        text: 'Open Debug',
        page: 'settings/restoreCounter',
      },
    ],
    type: MESSAGE_TYPES.INFO,
  },

  'keyset id inactive.': {
    title: 'Keyset Inactive',
    text: 'You need to update your wallet',
    buttons: [
      {
        text: 'Update Wallet',
        page: 'update-wallet',
      },
    ],
    type: MESSAGE_TYPES.INFO,
  },

  // Cashu related
  'bad response': {
    title: 'Bad Response',
    text: 'This error is typically due to a problem with the mint you are trying to use. Please try a different mint.',
    type: MESSAGE_TYPES.ERROR,
  },

  'Error Rate limit exceeded.': {
    title: 'Rate Limit Exceeded',
    text: 'You have exceeded the allowed number of requests. Please try again later.',
    type: MESSAGE_TYPES.ERROR,
  },

  'Token already spent.': {
    title: 'Token Already Spent',
    text: 'This token has already been spent. Each token can only be redeemed once',
    type: MESSAGE_TYPES.WARNING,
  },
  'Insufficient funds': {
    title: 'Insufficient Funds',
    text: 'You do not have enough funds to complete this transaction.',
    type: MESSAGE_TYPES.ERROR,
  },
  'Witness is missing for p2pk signature': {
    title: 'Witness is missing for p2pk signature',
    text: "This happens when you try to spend ecash locked to someone else's pubkey",
    type: MESSAGE_TYPES.ERROR,
  },
  'mint quote already issued': {
    title: 'Invoice already paid',
    text: 'This invoice has already been paid.',
    type: MESSAGE_TYPES.ERROR,
  },
  no_funds: {
    title: 'No New ecash',
    text: "You don't have any new ecash to redeem.",
    type: MESSAGE_TYPES.ERROR,
  },
};

type MessageCode = keyof typeof MESSAGE_CONFIGS;

type ShowMessageOptions = {
  buttons?: any;
  emoji?: string;
  dismissable?: boolean;
  variant?: string;
  [key: string]: any; // Allow additional properties
};

export const showMessage = (
  messageCode: MessageCode,
  params = {},
  options: ShowMessageOptions = {},
  onClose: ((data: unknown) => void) | undefined = undefined
) => {
  console.log(129837, `!${messageCode}!`);
  const config =
    MESSAGE_CONFIGS[messageCode] || { title: messageCode } || MESSAGE_CONFIGS['general_error'];

  const text = typeof config.text === 'function' ? config.text(params) : config.text;

  const variant = options.variant || 'alert'; // Default to alert if not specified

  const payload = {
    message: config.title,
    buttons: config.buttons || [],
    submessage: text,
    emoji: options.emoji || MESSAGE_EMOJIS[config.type] || MESSAGE_EMOJIS.ERROR,
    dismissable: options.dismissable ?? true,
    variant, // Add variant to payload
    ...options,
  };

  const isModal = router?.canGoBack();

  SheetManager.show('popup-sheet', {
    context: isModal ? undefined : 'global',
    payload,
    onClose,
  });
};

// Optional: Helper functions for common scenarios
export const showSuccess = (
  messageCode: MessageCode,
  params: Record<string, any>,
  options: Record<string, any> = {},
  onClose?: (data: unknown) => void
) => showMessage(messageCode, params, { ...options, type: MESSAGE_TYPES.SUCCESS }, onClose);

export const showError = (
  messageCode: MessageCode,
  params: Record<string, any>,
  options: Record<string, any> = {},
  onClose?: (data: unknown) => void
) => showMessage(messageCode, params, { ...options, type: MESSAGE_TYPES.ERROR }, onClose);

export const showWarning = (
  messageCode: MessageCode,
  params: Record<string, any>,
  options: Record<string, any> = {},
  onClose?: (data: unknown) => void
) => showMessage(messageCode, params, { ...options, type: MESSAGE_TYPES.WARNING }, onClose);

export const showInfo = (
  messageCode: MessageCode,
  params: Record<string, any>,
  options: Record<string, any> = {},
  onClose?: (data: unknown) => void
) => showMessage(messageCode, params, { ...options, type: MESSAGE_TYPES.INFO }, onClose);

// Export constants for use in other files
export { MESSAGE_TYPES, MESSAGE_EMOJIS, MESSAGE_CONFIGS };
