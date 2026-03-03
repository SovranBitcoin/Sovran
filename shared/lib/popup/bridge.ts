import type { ReactNode } from 'react';
import type { PopupIcon } from './icons';
import type { PopupTextSegment } from './format';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import type { ActionSheetPayloads } from './actionSheetTypes';

export type { ActionSheetPayloads } from './actionSheetTypes';

type ToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

type ToastManager = {
  show: (options: string | Record<string, unknown>) => string;
  hide: (ids?: string | string[] | 'all') => void;
};

let toastManagerRef: ToastManager | null = null;

export function registerToast(manager: ToastManager) {
  toastManagerRef = manager;
}

export type ToastConfig = {
  variant: ToastVariant;
  label: string;
  description?: string;
  duration?: number | 'persistent';
  onHide?: () => void;
};

export type SheetConfig = {
  message: string;
  submessage?: ReactNode | PopupTextSegment[];
  icon?: PopupIcon;
  dismissable?: boolean;
  duration?: number;
  buttons?: { text: string; page?: string; onPress?: () => void }[];
  onClose?: (data: unknown) => void;
};

export function showToast(config: ToastConfig) {
  if (!toastManagerRef) {
    console.warn('popup: toast manager not registered yet');
    return;
  }

  toastManagerRef.show({
    variant: config.variant,
    label: config.label,
    description: config.description,
    duration: config.duration,
    onHide: config.onHide,
  });
}

export function showSheet(config: SheetConfig) {
  usePopupStore.getState().open(config);
}

export function showActionSheet<K extends keyof ActionSheetPayloads>(
  sheetId: K,
  payload: ActionSheetPayloads[K]
): void {
  usePopupStore.getState().open({ sheetId, payload });
}
