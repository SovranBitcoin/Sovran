import type { ReactNode } from 'react';
import { popupLog } from '../../logger';
import { showToast, showSheet, type ToastConfig, type SheetConfig } from './bridge';
import type { LiveSheetConfig } from '../liveSheetTypes';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';
import { flattenSegments } from '../format';
import type { SheetCloseEvent } from '@/shared/stores/runtime/popupStore';

type PopupVariant = 'toast' | 'sheet';
type PopupSeverity = 'success' | 'error' | 'warning' | 'info';

const TOAST_VARIANT_MAP: Record<PopupSeverity, ToastConfig['variant']> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'default',
};

type PopupText = string | ReactNode | PopupTextSegment[];

type PopupButton = {
  text: string;
  page?: string;
  onPress?: () => void;
};

interface PopupConfig {
  message: string;
  text?: PopupText;
  icon?: PopupIcon;
  variant?: PopupVariant;
  dismissable?: boolean;
  duration?: number;
  buttons?: PopupButton[];
  onOpen?: () => void;
  onClose?: (event: SheetCloseEvent) => void;
  type?: PopupSeverity;
  live?: LiveSheetConfig;
}

export const popup = (config: PopupConfig) => {
  const { message, text, icon, buttons, type, variant: explicitVariant, ...options } = config;

  const resolvedButtons = buttons ?? [];
  const severity: PopupSeverity = type ?? 'info';
  const variant: PopupVariant = explicitVariant ?? (resolvedButtons.length > 0 ? 'sheet' : 'toast');

  popupLog.info('popup.engine.invoke', {
    message,
    variant,
    type: severity,
    buttonCount: resolvedButtons.length,
    duration: options.duration,
    hasIcon: !!icon,
    hasLive: !!options.live,
  });

  if (variant === 'sheet') {
    const sheetConfig: SheetConfig = {
      message,
      submessage: text,
      icon,
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
    variant: TOAST_VARIANT_MAP[severity],
    label: message,
    description,
    icon,
    duration: options.duration,
    onShow: options.onOpen,
    onHide: options.onClose ? () => options.onClose!({ reason: 'dismiss' }) : undefined,
  };
  showToast(toastConfig);
};

function resolveToastDescription(text: PopupText | undefined): string | undefined {
  if (text == null) return undefined;
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return flattenSegments(text as PopupTextSegment[]);
  return undefined;
}
