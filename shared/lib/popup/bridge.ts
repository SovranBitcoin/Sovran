import React from 'react';
import type { ReactNode } from 'react';
import { log } from '../logger';
import type { PopupIcon } from './icons';
import type { PopupTextSegment } from './format';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import type { ActionSheetPayloads } from './actionSheetTypes';
import { CompactToast } from './CompactToast';
import type { LiveSheetConfig } from './liveSheetTypes';

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
  icon?: React.ReactNode;
  duration?: number | 'persistent';
  onShow?: () => void;
  onHide?: () => void;
};

export type CustomToastConfig = {
  component: (
    props: Record<string, unknown> & { hide: (ids?: string | string[] | 'all') => void }
  ) => React.ReactElement;
  duration?: number | 'persistent';
  onShow?: () => void;
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
  live?: LiveSheetConfig;
};

export function showToast(config: ToastConfig) {
  if (!toastManagerRef) {
    log.warn('popup.toast_manager_not_registered');
    return;
  }

  toastManagerRef.show({
    component: (props: Record<string, unknown>) =>
      React.createElement(CompactToast, {
        ...props,
        variant: config.variant,
        label: config.label,
        description: config.description,
        icon: config.icon,
      }),
    duration: config.duration,
    onShow: config.onShow,
    onHide: config.onHide,
  });
}

export function showCustomToast(config: CustomToastConfig) {
  if (!toastManagerRef) {
    log.warn('popup.toast_manager_not_registered');
    return;
  }

  toastManagerRef.show({
    component: (props: Record<string, unknown>) =>
      config.component(
        props as Record<string, unknown> & { hide: (ids?: string | string[] | 'all') => void }
      ),
    duration: config.duration,
    onShow: config.onShow,
    onHide: config.onHide,
  });
}

export function showSheet(config: SheetConfig) {
  usePopupStore.getState().open(config);
}

/** Set duration (ms) on the current sheet. Starts auto-close timer. Call anytime while sheet is open. */
export function setPopupDuration(ms: number): void {
  usePopupStore.getState().update({ duration: ms });
}

export function showActionSheet<K extends keyof ActionSheetPayloads>(
  sheetId: K,
  payload: ActionSheetPayloads[K]
): void {
  usePopupStore.getState().open({ sheetId, payload });
}
