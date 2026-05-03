import type { ReactNode } from 'react';
import { log } from '../logger';
import { showToast, showSheet, type ToastConfig, type SheetConfig } from './bridge';
import type { LiveSheetConfig } from './liveSheetTypes';
import type { PopupIcon } from './icons';
import type { PopupTextSegment } from './format';
import { flattenSegments } from './format';
import type { SheetCloseEvent } from '@/shared/stores/runtime/popupStore';

const popupLog = log.child({ module: 'popup' });

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

type MessageText = string | ReactNode | PopupTextSegment[] | ((params: any) => ReactNode);

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

/**
 * Runtime error-string matching only. These keys are matched against
 * `error.message` strings thrown by cashu/mint libraries at runtime.
 *
 * For all intentional/named popups, use the typed functions in `shared/lib/popup/popups.ts`.
 */
const MESSAGE_CONFIGS: Record<string, MessageConfig> = {
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
  icon?: PopupIcon;
  /** @deprecated Use `icon: 'emoji:...'` instead */
  emoji?: string;
  variant?: PopupVariant;
  dismissable?: boolean;
  duration?: number;
  buttons?: MessageButton[];
  onOpen?: () => void;
  onClose?: (event: SheetCloseEvent) => void;
  type?: MessageType;
  live?: LiveSheetConfig;
}

export const popup = (config: popupConfig | string) => {
  const originalInput = typeof config === 'string' ? config : config.message;
  if (typeof config === 'string') {
    config = { message: config };
  }

  const { message, params = {}, text: overrideText, emoji, ...options } = config;

  if (emoji && !options.icon) {
    options.icon = `emoji:${emoji}`;
  }

  const matchedKnownError =
    typeof message === 'string' && MESSAGE_CONFIGS[message] ? message : null;
  const messageConfig = matchedKnownError
    ? MESSAGE_CONFIGS[matchedKnownError]
    : { title: message, text: message, type: MESSAGE_TYPES.INFO };

  const resolvedText =
    typeof messageConfig.text === 'function' ? messageConfig.text(params) : messageConfig.text;
  const resolvedOverrideText =
    typeof overrideText === 'function' ? overrideText(params) : overrideText;
  const text = resolvedOverrideText ?? resolvedText;

  const resolvedButtons = options.buttons || messageConfig.buttons || [];
  const messageType = options.type || messageConfig.type || MESSAGE_TYPES.INFO;

  const variantReason: 'explicit' | 'config-default' | 'has-buttons' | 'default-toast' =
    options.variant
      ? 'explicit'
      : messageConfig.variant
        ? 'config-default'
        : resolvedButtons.length > 0
          ? 'has-buttons'
          : 'default-toast';

  const variant: PopupVariant =
    (options.variant as PopupVariant) ||
    (messageConfig.variant as PopupVariant) ||
    (resolvedButtons.length > 0 ? 'sheet' : 'toast');

  popupLog.info('popup.engine.invoke', {
    originalMessage: originalInput,
    matchedKnownError,
    variant,
    variantReason,
    type: messageType,
    buttonCount: resolvedButtons.length,
    duration: options.duration,
    hasIcon: !!options.icon,
    hasLive: !!options.live,
    hasOverrideText: overrideText != null,
  });

  if (variant === 'sheet') {
    const sheetConfig: SheetConfig = {
      message: messageConfig.title,
      submessage: text,
      icon: options.icon,
      dismissable: options.dismissable ?? true,
      duration: options.duration,
      buttons: resolvedButtons,
      onClose: options.onClose,
      live: options.live,
    };
    if (options.live) {
      Object.assign(sheetConfig, options.live.get());
    }
    showSheet(sheetConfig);
    return;
  }

  const description = resolveToastDescription(text);

  const toastConfig: ToastConfig = {
    variant: TOAST_VARIANT_MAP[messageType] || 'default',
    label: messageConfig.title,
    description,
    icon: options.icon,
    duration: options.duration,
    onShow: options.onOpen,
    onHide: options.onClose ? () => options.onClose!({ reason: 'dismiss' }) : undefined,
  };
  showToast(toastConfig);
};

function resolveToastDescription(text: MessageText | undefined): string | undefined {
  if (text == null) return undefined;
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return flattenSegments(text as PopupTextSegment[]);
  return undefined;
}
