import type { ReactNode } from 'react';
import { usePopupStore } from '@/stores/popupStore';

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
  submessage?: ReactNode;
  icon?: ReactNode;
  emoji?: string;
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
