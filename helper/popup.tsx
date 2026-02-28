import React from 'react';
import { Text } from 'components/ui/Text';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { showToast, showSheet, type ToastConfig, type SheetConfig } from '@/helper/popupBridge';

type PopupVariant = 'toast' | 'sheet';

const MESSAGE_TYPES = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  SUCCESS: 'success',
} as const;

type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

const TOAST_VARIANT_MAP: Record<string, ToastConfig['variant']> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'default',
};

type MessageText = string | React.ReactNode | ((params: any) => React.ReactNode);

type MessageButton = {
  text: string;
  page?: string;
  onPress?: () => void;
};

type MessageConfig = {
  title: string;
  text: MessageText;
  type: string;
  buttons?: MessageButton[];
  variant?: string;
};

const MESSAGE_CONFIGS: Record<string, MessageConfig> = {
  funds_sent: {
    title: 'Funds Sent',
    text: 'Funds have been sent successfully.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  ecash_token_shared_via_nfc: {
    title: 'Ecash Token Shared via NFC',
    text: 'Ecash token has been shared via NFC.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  latest_version: {
    title: 'New Version Available',
    text: ({ version: _version }: { version: string }) =>
      `A new version of the app is available. Please update to the latest version.`,
    type: MESSAGE_TYPES.INFO,
    variant: 'sheet',
  },
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
  p2pk_copied: {
    title: 'P2PK Key Copied',
    text: 'P2PK public key has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  mnemonic_copied: {
    title: 'Mnemonic Copied',
    text: 'Recovery phrase has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  cashu_mnemonic_copied: {
    title: 'Cashu Mnemonic Copied',
    text: 'Cashu recovery phrase has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  lightning_address_copied: {
    title: 'Address Copied',
    text: 'Lightning address has been copied to your clipboard.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  camera_permission_denied: {
    title: 'Camera Permission Denied',
    text: 'Camera access is denied. Please enable it in your device settings.',
    type: MESSAGE_TYPES.ERROR,
  },
  camera_permission_granted: {
    title: 'Camera Permission Granted',
    text: 'Camera access has been granted.',
    type: MESSAGE_TYPES.SUCCESS,
  },
  camera_permission_blocked: {
    title: 'Camera Permission Blocked',
    text: 'Camera access is blocked. Please enable it in your device settings.',
    buttons: [{ text: 'Open Settings', page: 'settings' }],
    type: MESSAGE_TYPES.ERROR,
  },
  insufficient_balance: {
    title: 'Insufficient Balance',
    text: ({ amount, unit, fee }: { amount: number; unit: string; fee: number }) => (
      <Text style={{ textAlign: 'center' }}>
        Not enough funds to send{' '}
        <AmountFormatter
          style={{ marginBottom: -4, marginLeft: 3 }}
          size={14}
          amount={amount}
          unit={unit}
        />{' '}
        with a fee of{' '}
        <AmountFormatter
          style={{ marginBottom: -4, marginLeft: 3 }}
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
  general_error: {
    title: 'Error Occurred',
    text: 'Something went wrong. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  feature_coming_soon: {
    title: 'Coming Soon',
    text: 'This feature is currently under development.',
    type: MESSAGE_TYPES.INFO,
  },
  not_implemented: {
    title: 'Not Implemented',
    text: 'This feature is not yet implemented.',
    type: MESSAGE_TYPES.INFO,
  },
  passcode_not_match: {
    title: 'Passcode Not Match',
    text: 'The passcode does not match. Please try again.',
    type: MESSAGE_TYPES.ERROR,
  },
  'outputs have already been signed before.': {
    title: 'Outputs have been signed before',
    text: 'Trying again should fix this. If not contact support.',
    type: MESSAGE_TYPES.INFO,
  },
  'keyset id inactive.': {
    title: 'Keyset Inactive',
    text: 'You need to update your wallet',
    buttons: [{ text: 'Update Wallet', page: 'update-wallet' }],
    type: MESSAGE_TYPES.INFO,
  },
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
  'Lightning payment failed: no_route.': {
    title: 'Lightning Payment Failed',
    text: "Your mint isn't well connected to the recipient's lightning network.",
    type: MESSAGE_TYPES.ERROR,
  },
};

interface popupConfig {
  message: string;
  params?: Record<string, any>;
  text?: MessageText;
  icon?: React.ReactNode;
  emoji?: string;
  variant?: PopupVariant;
  dismissable?: boolean;
  duration?: number;
  buttons?: MessageButton[];
  onClose?: (data: unknown) => void;
  type?: MessageType;
}

export const popup = (config: popupConfig | string) => {
  if (typeof config === 'string') {
    config = { message: config };
  }

  const { message, params = {}, text: overrideText, ...options } = config;

  const messageConfig =
    typeof message === 'string' && MESSAGE_CONFIGS[message]
      ? MESSAGE_CONFIGS[message]
      : { title: message, text: message, type: MESSAGE_TYPES.INFO };

  const resolvedText =
    typeof messageConfig.text === 'function' ? messageConfig.text(params) : messageConfig.text;
  const resolvedOverrideText =
    typeof overrideText === 'function' ? overrideText(params) : overrideText;
  const text = resolvedOverrideText ?? resolvedText;

  const resolvedButtons = options.buttons || messageConfig.buttons || [];
  const messageType = options.type || messageConfig.type || MESSAGE_TYPES.INFO;

  const variant: PopupVariant =
    (options.variant as PopupVariant) ||
    (messageConfig.variant as PopupVariant) ||
    (resolvedButtons.length > 0 ? 'sheet' : 'toast');

  if (variant === 'sheet') {
    const sheetConfig: SheetConfig = {
      message: messageConfig.title,
      submessage: text,
      icon: options.icon,
      emoji: options.emoji,
      dismissable: options.dismissable ?? true,
      duration: options.duration,
      buttons: resolvedButtons,
      onClose: options.onClose,
    };
    showSheet(sheetConfig);
    return;
  }

  const toastConfig: ToastConfig = {
    variant: TOAST_VARIANT_MAP[messageType] || 'default',
    label: messageConfig.title,
    description: typeof text === 'string' ? text : undefined,
    duration: options.duration,
    onHide: options.onClose ? () => options.onClose!({ reason: 'dismiss' }) : undefined,
  };
  showToast(toastConfig);
};
