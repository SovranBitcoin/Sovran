import React from 'react';
import type { ReactNode } from 'react';
import { popupLog } from '../../logger';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import type { SheetCloseEvent } from '@/shared/stores/runtime/popupStore';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import { CompactToast } from '../CompactToast';
import { E2EStaticToastRenderMarker } from '../E2EToastProbe';
import type { LiveSheetConfig } from '../liveSheetTypes';

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
let toastSequence = 0;

function nextToastId(): string {
  toastSequence += 1;
  return `toast-${Date.now().toString(36)}-${toastSequence.toString(36)}`;
}

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
  debugLabel?: string;
  debugFields?: Record<string, unknown>;
  /** Closed static-popup key; never a toast message or payment value. */
  e2eProbeKey?: string;
};

type CustomToastConfig = {
  component: (
    props: Record<string, unknown> & { hide: (ids?: string | string[] | 'all') => void }
  ) => React.ReactElement;
  duration?: number | 'persistent';
  onShow?: () => void;
  onHide?: () => void;
  debugLabel?: string;
  debugFields?: Record<string, unknown>;
};

export type SheetConfig = {
  message: string;
  submessage?: ReactNode | PopupTextSegment[];
  icon?: PopupIcon;
  dismissable?: boolean;
  duration?: number;
  buttons?: { text: string; page?: string; onPress?: () => void }[];
  buttonLayout?: 'row' | 'stack';
  onClose?: (event: SheetCloseEvent) => void;
  live?: LiveSheetConfig;
  /** DEV-only e2e probe key mirrored into AX by the sheet body. */
  e2eProbeKey?: string;
};

export function showToast(config: ToastConfig) {
  const caller = getCallerFrame();
  const toastId = nextToastId();
  popupLog.info('popup.toast.show', {
    toastId,
    variant: config.variant,
    label: config.label,
    debugLabel: config.debugLabel,
    description: config.description?.slice(0, 160),
    duration: config.duration,
    hasIcon: !!config.icon,
    caller,
    ...(config.debugFields ?? {}),
  });

  if (!toastManagerRef) {
    popupLog.warn('popup.toast.manager_not_registered', { toastId, label: config.label, caller });
    return;
  }

  let managerToastId: string | undefined;
  managerToastId = toastManagerRef.show({
    component: (props: Record<string, unknown>) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(E2EStaticToastRenderMarker, {
          probeKey: config.e2eProbeKey,
        }),
        React.createElement(CompactToast, {
          ...props,
          variant: config.variant,
          label: config.label,
          description: config.description,
          icon: config.icon,
        })
      ),
    duration: config.duration,
    onShow: () => {
      popupLog.info('popup.toast.shown', {
        toastId,
        managerToastId,
        label: config.label,
        variant: config.variant,
        debugLabel: config.debugLabel,
        ...(config.debugFields ?? {}),
      });
      config.onShow?.();
    },
    onHide: () => {
      popupLog.info('popup.toast.hidden', {
        toastId,
        managerToastId,
        label: config.label,
        variant: config.variant,
        debugLabel: config.debugLabel,
        ...(config.debugFields ?? {}),
      });
      config.onHide?.();
    },
  });
}

export function showCustomToast(config: CustomToastConfig) {
  const caller = getCallerFrame();
  const toastId = nextToastId();
  const componentName =
    (config.component as { displayName?: string; name?: string }).displayName ||
    (config.component as { displayName?: string; name?: string }).name ||
    'anonymous';
  popupLog.info('popup.toast.custom_show', {
    toastId,
    componentName,
    debugLabel: config.debugLabel,
    duration: config.duration,
    caller,
    ...(config.debugFields ?? {}),
  });

  if (!toastManagerRef) {
    popupLog.warn('popup.toast.manager_not_registered', { toastId, componentName, caller });
    return;
  }

  let managerToastId: string | undefined;
  managerToastId = toastManagerRef.show({
    component: (props: Record<string, unknown>) =>
      config.component({
        ...props,
        toastId,
        debugLabel: config.debugLabel,
        toastDebugFields: config.debugFields,
      } as unknown as Record<string, unknown> & {
        hide: (ids?: string | string[] | 'all') => void;
      }),
    duration: config.duration,
    onShow: () => {
      popupLog.info('popup.toast.custom_shown', {
        toastId,
        managerToastId,
        componentName,
        debugLabel: config.debugLabel,
        ...(config.debugFields ?? {}),
      });
      config.onShow?.();
    },
    onHide: () => {
      popupLog.info('popup.toast.custom_hidden', {
        toastId,
        managerToastId,
        componentName,
        debugLabel: config.debugLabel,
        ...(config.debugFields ?? {}),
      });
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

export function showActionSheet<K extends keyof ActionSheetPayloads>(
  sheetId: K,
  payload: ActionSheetPayloads[K]
): void {
  const caller = getCallerFrame();
  popupLog.info('popup.sheet.action_show', { sheetId, caller });
  usePopupStore.getState().open({ sheetId, payload });
}
