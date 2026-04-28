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

const popupLog = log.child({ module: 'popup' });

/** Best-effort first stack frame outside the popup module — gives "where did this come from" without a full trace. */
function getCallerFrame(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const lines = stack.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (line.includes('getCallerFrame')) continue;
    if (line.includes('/popup/bridge')) continue;
    if (line.includes('/popup/engine')) continue;
    return line.replace(/^at\s+/, '').slice(0, 200);
  }
  return undefined;
}

function describeSubmessage(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.slice(0, 160);
  if (Array.isArray(value)) return `[segments x${value.length}]`;
  return '[node]';
}

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
  /** Declarative icon — resolved inside CompactToast so the icon color
   * tracks the (theme-aware) toast foreground. */
  icon?: PopupIcon;
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
  const caller = getCallerFrame();
  popupLog.info('popup.toast.show', {
    variant: config.variant,
    label: config.label,
    description: config.description?.slice(0, 160),
    duration: config.duration,
    hasIcon: !!config.icon,
    caller,
  });

  if (!toastManagerRef) {
    popupLog.warn('popup.toast.manager_not_registered', { label: config.label, caller });
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
    onShow: () => {
      popupLog.info('popup.toast.shown', { label: config.label, variant: config.variant });
      config.onShow?.();
    },
    onHide: () => {
      popupLog.info('popup.toast.hidden', { label: config.label, variant: config.variant });
      config.onHide?.();
    },
  });
}

export function showCustomToast(config: CustomToastConfig) {
  const caller = getCallerFrame();
  const componentName =
    (config.component as { displayName?: string; name?: string }).displayName ||
    (config.component as { displayName?: string; name?: string }).name ||
    'anonymous';
  popupLog.info('popup.toast.custom_show', {
    componentName,
    duration: config.duration,
    caller,
  });

  if (!toastManagerRef) {
    popupLog.warn('popup.toast.manager_not_registered', { componentName, caller });
    return;
  }

  toastManagerRef.show({
    component: (props: Record<string, unknown>) =>
      config.component(
        props as Record<string, unknown> & { hide: (ids?: string | string[] | 'all') => void }
      ),
    duration: config.duration,
    onShow: () => {
      popupLog.info('popup.toast.custom_shown', { componentName });
      config.onShow?.();
    },
    onHide: () => {
      popupLog.info('popup.toast.custom_hidden', { componentName });
      config.onHide?.();
    },
  });
}

export function showSheet(config: SheetConfig) {
  const caller = getCallerFrame();
  popupLog.info('popup.sheet.show', {
    message: config.message,
    submessage: describeSubmessage(config.submessage),
    buttonCount: config.buttons?.length ?? 0,
    buttonLabels: config.buttons?.map((b) => b.text),
    dismissable: config.dismissable ?? true,
    duration: config.duration,
    hasIcon: !!config.icon,
    hasLive: !!config.live,
    caller,
  });
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
  const caller = getCallerFrame();
  popupLog.info('popup.sheet.action_show', { sheetId, caller });
  usePopupStore.getState().open({ sheetId, payload });
}
